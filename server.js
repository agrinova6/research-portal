import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const jwtSecret = process.env.JWT_SECRET;

const supabase = createClient(supabaseUrl, supabaseKey);

if (!jwtSecret) {
  throw new Error("JWT_SECRET is not defined in environment variables");
}

// Middleware to verify JWT and set req.user
const verifyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization header missing or invalid" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded; // store user info in req.user
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Routes

// Login Route
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const { data: users, error } = await supabase
    .from("profiles")
    .select("id, email, name, password")
    .eq("email", email)
    .single();

  if (error) {
    return res.status(500).json({ message: "Database error", error: error.message });
  }

  if (!users) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // WARNING: Password is stored as plain text here. In production, hash your passwords!

  if (users.password !== password) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Create JWT token
  const access_token = jwt.sign(
    { id: users.id, email: users.email, name: users.name },
    jwtSecret,
    { expiresIn: "12h" }
  );

  res.json({ access_token });
});

// Get Members List
app.get("/api/members", verifyAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name");

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// Get Research Summary
app.get("/api/research-summary", verifyAuth, async (req, res) => {
  try {
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, name");

    if (pErr) return res.status(500).json({ error: pErr.message });

    const summaries = [];

    for (let prof of profiles) {
      const today = dayjs().startOf("day");
      const tomorrow = today.add(1, "day");
      const yesterday = today.subtract(1, "day");

      const { data: recs, error: rErr } = await supabase
        .from("research")
        .select("id, description, file_url, created_at")
        .eq("user_id", prof.id)
        .gte("created_at", yesterday.toISOString())
        .lt("created_at", tomorrow.toISOString());

      if (rErr) return res.status(500).json({ error: rErr.message });

      summaries.push({
        id: prof.id,
        name: prof.name,
        recs,
      });
    }

    res.json(summaries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Research Record
app.post("/api/research", verifyAuth, async (req, res) => {
  const { description, file_url } = req.body;

  if (!description) {
    return res.status(400).json({ message: "Description is required" });
  }

  const newResearch = {
    description,
    file_url: file_url || null,
    user_id: req.user.id,
  };

  const { data, error } = await supabase.from("research").insert(newResearch).select().single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json(data);
});

// Add Log Entry
app.post("/api/log", verifyAuth, async (req, res) => {
  const { description, user_id } = req.body;

  if (!description || !user_id) {
    return res.status(400).json({ message: "Description and user_id are required" });
  }

  const newLog = {
    description,
    user_id,
  };

  const { data, error } = await supabase.from("logs").insert(newLog).select().single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json(data);
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
