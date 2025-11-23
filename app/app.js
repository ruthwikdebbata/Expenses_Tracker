// Import express.js
const express = require("express");

const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { User } = require("./models/user");

// Create express app
var app = express();
// Body parsers
app.use(bodyParser.urlencoded({ extended: true }));
app.use(sessionMiddleware);
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
const oneDay = 1000 * 60 * 60 * 24;
app.use(
  session({
    secret: "secretkeysdfjsflyoifasd",
    saveUninitialized: true,
    resave: false,
    cookie: { maxAge: oneDay },
  })
);

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


// login api
app.post('/set-password', async function (req, res) {
    const params = req.body;
    const user = new User(params.email);

    try {
        const uId = await user.getIdFromEmail();
        if (uId) {
            await user.setUserPassword(params.password);
            console.log(req.session.id);
            res.send('password reset succesfully');
        } else {
            const newId = await user.addUser(params.email);
            res.send('Account created succesfully');
        }
    } catch (err) {
        console.error(`Error while setting password `, err.message);
        res.send('An error occurred while setting the password');
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
                res.redirect('/main');
            } else {
                res.send('Invalid email');
            }
        } else {
            res.send('Invalid email');
        }
    } catch (err) {
        console.error(`Error while comparing `, err.message);
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
