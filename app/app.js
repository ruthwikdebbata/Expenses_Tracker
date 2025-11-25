// Import express.js
const express = require("express");

const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { User } = require("./models/user");
const oneDay = 1000 * 60 * 60 * 24;
const sessionMiddleware = session({
  secret: "secretkeysdfjsflyoifasd",
  saveUninitialized: true,
  resave: false,
  cookie: { maxAge: oneDay },
});

// Create express app
var app = express();
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

// Create a route for root - /
app.get("/", function(req, res) {
    res.send("Hello world!");
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
      `SELECT e.spent_at, e.description, e.amount, COALESCE(c.name, 'Uncategorized') AS category
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

// Logout
app.get('/logout', function (req, res) {
    req.session.destroy();
    res.redirect('/login');
});

// Start server on port 3000
app.listen(3000,function(){
    console.log(`Server running at http://127.0.0.1:3000/`);
});
