// Import express.js
const express = require("express");

const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");

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


// Start server on port 3000
app.listen(3000,function(){
    console.log(`Server running at http://127.0.0.1:3000/`);
});