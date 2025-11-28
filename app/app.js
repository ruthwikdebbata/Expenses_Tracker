// Import express.js
const express = require("express");

const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { User } = require("./models/user");
const oneDay = 1000 * 60 * 60 * 24;

// Create express app
var app = express();
// Trust proxy helps when running behind Docker/compose so secure cookies work as expected.
app.set('trust proxy', 1);
const sessionMiddleware = session({
  secret: "secretkeysdfjsflyoifasd",
  saveUninitialized: false, // only save when something meaningful is set
  resave: false,
  rolling: true, // refresh expiry on each request
  cookie: {
    maxAge: oneDay,
    sameSite: 'lax',
    secure: false, // set to true only when serving over HTTPS
  },
});

// Body parsers
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Add static files location
app.use(express.static("static"));
// Pug setup
app.set("view engine", "pug");
app.set("views", "./app/views");

// Get the functions in the db.js file to use
const db = require('./services/db');

// Session + cookies
app.use(cookieParser());
app.use(sessionMiddleware);

// Simple auth guard for API routes
function requireAuth(req, res, next) {
  if (!req.session || !req.session.uid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function validateExpensePayload(body) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Amount must be a positive number';
  }

  const spentAt = body.spentAt ? new Date(body.spentAt) : new Date();
  if (Number.isNaN(spentAt.getTime())) {
    return 'Invalid spentAt date';
  }

  const currency = body.currency || 'GBR';
  if (typeof currency !== 'string' || currency.length !== 3) {
    return 'Currency must be a 3-letter code';
  }

  const categoryIdRaw = body.categoryId ?? body.category_id;
  const categoryId = categoryIdRaw === undefined || categoryIdRaw === null || categoryIdRaw === '' || categoryIdRaw === 'other'
    ? null
    : Number(categoryIdRaw);

  if (categoryId !== null && !Number.isInteger(categoryId)) {
    return 'Category must be a valid id or omitted';
  }

  return {
    categoryId,
    description: body.description || null,
    amount,
    currency: currency.toUpperCase(),
    spentAt: spentAt.toISOString().slice(0, 19).replace('T', ' '), // MySQL DATETIME
  };
}

// Create a route for root - /
app.get("/", function(req, res) {
  if (req.session && req.session.uid) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

// Render login form
app.get("/login", (req, res) => {
  res.render("login");
});

// Render register form
app.get("/register", (req, res) => {
  res.render("register");
});


// Register / create user
app.post('/register', async function (req, res) {
    const { name, email, password, confirmPassword } = req.body;
    const user = new User(email);

    if (!password || password !== confirmPassword) {
        return res.status(400).send('Passwords do not match');
    }

    try {
        const existingId = await user.getIdFromEmail();
        if (existingId) {
            return res.status(400).send('Account already exists, please login');
        }
        await user.addUser(password, name);
        res.redirect('/login');
    } catch (err) {
        console.error(`Error while registering `, err.message);
        res.status(500).send('An error occurred while creating the account');
    }
});


// Check submitted email and password pair
app.post('/authenticate', async function (req, res) {
    const params = req.body; 
    const user = new User(params.email);
    
    try {
        const uId = await user.getIdFromEmail();
        if (uId) {
            const match = await user.authenticate(params.password);
            console.log(match);
            if (match) {
                req.session.uid = uId;
                req.session.loggedIn = true;
                console.log(req.session.id);
                res.redirect('/dashboard');
            } else {
                res.status(401).send('Invalid email or password');
            }
        } else {
            res.status(401).send('Invalid email or password');
        }
    } catch (err) {
        console.error(`Error while comparing `, err.message);
    }
});

// Dashboard with user data
app.get('/dashboard', async (req, res) => {
  if (!req.session || !req.session.uid) {
    return res.redirect('/login');
  }

  const userId = req.session.uid;

  try {
    const userRows = await db.query('SELECT name, email FROM Users WHERE id = ?', [userId]);
    const userInfo = userRows[0] || { name: 'User' };

    const summaryRows = await db.query(
      `SELECT 
         COALESCE(SUM(amount), 0) AS monthTotal,
         COALESCE(SUM(amount), 0) / GREATEST(DAY(LAST_DAY(CURDATE())), 1) AS avgPerDay
       FROM Expenses
       WHERE user_id = ? AND spent_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      [userId]
    );

    const totalRows = await db.query(
      `SELECT 
         COALESCE(SUM(amount), 0) AS totalExpenses,
         (SELECT COUNT(*) FROM Categories WHERE user_id = ?) AS categories
       FROM Expenses
       WHERE user_id = ?`,
      [userId, userId]
    );

    const categoryBreakdown = await db.query(
      `SELECT c.id, c.name, COALESCE(SUM(e.amount), 0) AS total
       FROM Categories c
       LEFT JOIN Expenses e ON e.category_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id, c.name
       ORDER BY total DESC, c.name ASC`,
      [userId]
    );

    const expenses = await db.query(
      `SELECT e.id, e.spent_at, e.description, e.amount, COALESCE(c.name, 'Uncategorized') AS category
       FROM Expenses e
       LEFT JOIN Categories c ON e.category_id = c.id
       WHERE e.user_id = ?
       ORDER BY e.spent_at DESC
       LIMIT 10`,
      [userId]
    );

    res.render('dashboard', {
      user: userInfo,
      summary: {
        monthTotal: summaryRows[0]?.monthTotal || 0,
        totalExpenses: totalRows[0]?.totalExpenses || 0,
        categories: totalRows[0]?.categories || 0,
        avgPerDay: summaryRows[0]?.avgPerDay || 0,
      },
      categoryBreakdown,
      expenses,
    });
  } catch (err) {
    console.error('Error loading dashboard', err);
    res.status(500).send('Unable to load dashboard right now.');
  }
});

// Add expense from dashboard form
app.post('/expenses', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const amount = Number(req.body.amount);
  const rawCategory = req.body.category_id;
  const categoryId = rawCategory === undefined || rawCategory === null || rawCategory === '' || rawCategory === 'other'
    ? null
    : Number(rawCategory);
  const description = req.body.description || null;
  const spentDate = req.body.spent_at;
  const currency = 'GBR';

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).send('Amount must be a positive number');
  }

  if (categoryId !== null && !Number.isInteger(categoryId)) {
    return res.status(400).send('Invalid category');
  }

  const spentAt = spentDate ? new Date(spentDate) : new Date();

  if (Number.isNaN(spentAt.getTime())) {
    return res.status(400).send('Invalid date');
  }

  const spentAtSql = spentAt.toISOString().slice(0, 19).replace('T', ' ');

  try {
    await db.query(
      `INSERT INTO Expenses (user_id, category_id, description, amount, currency, spent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, categoryId, description, amount, currency, spentAtSql]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error creating expense from dashboard', err);
    res.status(500).send('Unable to create expense right now.');
  }
});

// Expense details view
app.get('/expenses/:id', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const expenseId = Number(req.params.id);

  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(404).send('Expense not found');
  }

  try {
    const rows = await db.query(
      `SELECT e.id, e.description, e.amount, e.currency, e.spent_at, e.category_id,
              COALESCE(c.name, 'Uncategorized') AS category
       FROM Expenses e
       LEFT JOIN Categories c ON e.category_id = c.id
       WHERE e.id = ? AND e.user_id = ?`,
      [expenseId, userId]
    );

    if (!rows.length) {
      return res.status(404).send('Expense not found');
    }

    const categories = await db.query(
      `SELECT id, name FROM Categories WHERE user_id = ? ORDER BY name ASC`,
      [userId]
    );

    res.render('expense', { expense: rows[0], categories });
  } catch (err) {
    console.error('Error loading expense detail', err);
    res.status(500).send('Unable to load expense right now.');
  }
});

// Update expense from detail view
app.post('/expenses/:id', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const expenseId = Number(req.params.id);

  const amount = Number(req.body.amount);
  const rawCategory = req.body.category_id;
  const categoryId = rawCategory === undefined || rawCategory === null || rawCategory === '' || rawCategory === 'other'
    ? null
    : Number(rawCategory);
  const description = req.body.description || null;
  const currency = (req.body.currency || 'GBR').toUpperCase();
  const spentDate = req.body.spent_at;

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).send('Amount must be a positive number');
  }
  if (categoryId !== null && !Number.isInteger(categoryId)) {
    return res.status(400).send('Invalid category');
  }

  const spentAt = spentDate ? new Date(spentDate) : new Date();
  if (Number.isNaN(spentAt.getTime())) {
    return res.status(400).send('Invalid date');
  }
  const spentAtSql = spentAt.toISOString().slice(0, 19).replace('T', ' ');

  try {
    const result = await db.query(
      `UPDATE Expenses
       SET category_id = ?, description = ?, amount = ?, currency = ?, spent_at = ?
       WHERE id = ? AND user_id = ?`,
      [categoryId, description, amount, currency, spentAtSql, expenseId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).send('Expense not found');
    }

    res.redirect(`/expenses/${expenseId}`);
  } catch (err) {
    console.error('Error updating expense', err);
    res.status(500).send('Unable to update expense right now.');
  }
});

// Delete expense
app.post('/expenses/:id/delete', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const expenseId = Number(req.params.id);

  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(404).send('Expense not found');
  }

  try {
    const result = await db.query(
      `DELETE FROM Expenses WHERE id = ? AND user_id = ?`,
      [expenseId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send('Expense not found');
    }
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error deleting expense', err);
    res.status(500).send('Unable to delete expense right now.');
  }
});

// Profile page
app.get('/profile', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const flash = req.session.profileFlash || null;
  delete req.session.profileFlash;
  try {
    const rows = await db.query(
      `SELECT name, email, created_at FROM Users WHERE id = ?`,
      [userId]
    );
    const user = rows[0] || { name: '', email: '', created_at: null };
    res.render('profile', { user, flash });
  } catch (err) {
    console.error('Error loading profile', err);
    res.status(500).send('Unable to load profile right now.');
  }
});

app.post('/profile/password', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  const setFlash = (type, message) => {
    req.session.profileFlash = { type, message };
  };

  if (!currentPassword || !newPassword || !confirmPassword) {
    setFlash('danger', 'All password fields are required.');
    return res.redirect('/profile');
  }
  if (newPassword !== confirmPassword) {
    setFlash('danger', 'New passwords do not match.');
    return res.redirect('/profile');
  }
  if (newPassword.length < 8) {
    setFlash('danger', 'New password must be at least 8 characters.');
    return res.redirect('/profile');
  }

  try {
    const rows = await db.query(
      `SELECT password FROM Users WHERE id = ?`,
      [userId]
    );
    if (!rows.length) {
      setFlash('danger', 'User not found.');
      return res.redirect('/profile');
    }

    const matches = await bcrypt.compare(currentPassword, rows[0].password);
    if (!matches) {
      setFlash('danger', 'Current password is incorrect.');
      return res.redirect('/profile');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE Users SET password = ? WHERE id = ?`,
      [hashed, userId]
    );
    setFlash('success', 'Password updated successfully.');
    res.redirect('/profile');
  } catch (err) {
    console.error('Error updating password', err);
    setFlash('danger', 'Unable to update password right now.');
    res.redirect('/profile');
  }
});

// Categories listing and creation
app.get('/categories', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  try {
    const categories = await db.query(
      `SELECT id, name, is_default, created_at
       FROM Categories
       WHERE user_id = ?
       ORDER BY name ASC`,
      [userId]
    );
    res.render('categories', { categories });
  } catch (err) {
    console.error('Error loading categories', err);
    res.status(500).send('Unable to load categories right now.');
  }
});

app.post('/categories', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const name = (req.body.name || '').trim();

  if (!name) {
    return res.status(400).send('Name is required');
  }

  try {
    await db.query(
      `INSERT INTO Categories (user_id, name, color, is_default)
       VALUES (?, ?, NULL, 0)`,
      [userId, name]
    );
    res.redirect('/categories');
  } catch (err) {
    console.error('Error creating category', err);
    // likely duplicate
    res.status(500).send('Unable to create category right now.');
  }
});

app.post('/categories/:id', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const categoryId = Number(req.params.id);
  const name = (req.body.name || '').trim();

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(404).send('Category not found');
  }
  if (!name) {
    return res.status(400).send('Name is required');
  }

  try {
    const result = await db.query(
      `UPDATE Categories SET name = ? WHERE id = ? AND user_id = ?`,
      [name, categoryId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send('Category not found');
    }
    res.redirect('/categories');
  } catch (err) {
    console.error('Error updating category', err);
    res.status(500).send('Unable to update category right now.');
  }
});

app.post('/categories/:id/delete', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const categoryId = Number(req.params.id);

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(404).send('Category not found');
  }

  try {
    const result = await db.query(
      `DELETE FROM Categories WHERE id = ? AND user_id = ?`,
      [categoryId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send('Category not found');
    }
    res.redirect('/categories');
  } catch (err) {
    console.error('Error deleting category', err);
    res.status(500).send('Unable to delete category right now.');
  }
});

// ----- Expenses CRUD API -----

// List latest expenses for the logged-in user
app.get('/api/expenses', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  try {
    const rows = await db.query(
      `SELECT e.id, e.description, e.amount, e.currency, e.spent_at, e.category_id,
              COALESCE(c.name, 'Uncategorized') AS category
       FROM Expenses e
       LEFT JOIN Categories c ON e.category_id = c.id
       WHERE e.user_id = ?
       ORDER BY e.spent_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listing expenses', err);
    res.status(500).json({ error: 'Unable to list expenses' });
  }
});

// Get a single expense
app.get('/api/expenses/:id', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const expenseId = Number(req.params.id);

  try {
    const rows = await db.query(
      `SELECT id, description, amount, currency, spent_at, category_id
       FROM Expenses
       WHERE id = ? AND user_id = ?`,
      [expenseId, userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching expense', err);
    res.status(500).json({ error: 'Unable to fetch expense' });
  }
});

// Create an expense
app.post('/api/expenses', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const payload = validateExpensePayload(req.body);
  if (typeof payload === 'string') {
    return res.status(400).json({ error: payload });
  }

  try {
    const result = await db.query(
      `INSERT INTO Expenses (user_id, category_id, description, amount, currency, spent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, payload.categoryId, payload.description, payload.amount, payload.currency, payload.spentAt]
    );
    res.status(201).json({ id: result.insertId, ...payload });
  } catch (err) {
    console.error('Error creating expense', err);
    res.status(500).json({ error: 'Unable to create expense' });
  }
});

// Update an expense
app.put('/api/expenses/:id', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const expenseId = Number(req.params.id);
  const payload = validateExpensePayload(req.body);
  if (typeof payload === 'string') {
    return res.status(400).json({ error: payload });
  }

  try {
    const result = await db.query(
      `UPDATE Expenses
       SET category_id = ?, description = ?, amount = ?, currency = ?, spent_at = ?
       WHERE id = ? AND user_id = ?`,
      [payload.categoryId, payload.description, payload.amount, payload.currency, payload.spentAt, expenseId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json({ id: expenseId, ...payload });
  } catch (err) {
    console.error('Error updating expense', err);
    res.status(500).json({ error: 'Unable to update expense' });
  }
});

// Delete an expense
app.delete('/api/expenses/:id', requireAuth, async (req, res) => {
  const userId = req.session.uid;
  const expenseId = Number(req.params.id);

  try {
    const result = await db.query(
      `DELETE FROM Expenses WHERE id = ? AND user_id = ?`,
      [expenseId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting expense', err);
    res.status(500).json({ error: 'Unable to delete expense' });
  }
});

// Logout
app.get('/logout', function (req, res) {
    req.session.destroy();
    res.redirect('/login');
});

// Start server on port 3000
app.listen(3000,function(){
    console.log(`Server running at http://127.0.0.1:3000/`);
});
