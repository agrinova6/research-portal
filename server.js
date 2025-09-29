import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const jwtSecret = process.env.JWT_SECRET;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY missing in env");
}
if (!jwtSecret) {
  throw new Error("JWT_SECRET is not defined in environment variables");
}

// Supabase admin client (service role)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Expose anon key + URL for frontend
app.get("/api/anon-key", (req, res) => {
  res.json({ anonKey: supabaseAnonKey, supabaseUrl });
});

// Middleware to verify JWT from Supabase
const verifyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization header missing or invalid" });
  }

  const token = authHeader.split(" ")[1];
  try {
    // Verify with your JWT_SECRET (must match Supabase JWT secret!)
    const decoded = jwt.verify(token, jwtSecret);

    // Supabase JWT stores user ID in sub claim
    req.user = { id: decoded.sub, ...decoded };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Login route: use Supabase Auth REST API to sign in user and get JWT
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    // Using native fetch (Node 18+ required), else use node-fetch or axios
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Supabase Auth error:", err);
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const data = await response.json();

    if (!data.access_token || !data.user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Return access token and user info to client
    res.json({ access_token: data.access_token, user: data.user });
  } catch (err) {
    console.error("Unexpected error in login:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

// Get list of members (profiles)
app.get("/api/members", verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("profiles").select("id, name");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get research summary for yesterday and today
app.get("/api/research-summary", verifyAuth, async (req, res) => {
  try {
    const { data: profiles, error: pErr } = await supabase.from("profiles").select("id, name");
    if (pErr) throw pErr;

    const summaries = [];
    const today = dayjs().startOf("day");
    const tomorrow = today.add(1, "day");
    const yesterday = today.subtract(1, "day");

    for (const prof of profiles) {
      const { data: recs, error: rErr } = await supabase
        .from("research")
        .select("id, description, file_url, created_at")
        .eq("user_id", prof.id)
        .gte("created_at", yesterday.toISOString())
        .lt("created_at", tomorrow.toISOString());

      if (rErr) throw rErr;

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

// Add research record
app.post("/api/research", verifyAuth, async (req, res) => {
  try {
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
    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/api/upload", verifyAuth, upload.single("file"), async (req, res) => {
  try {
    const { description } = req.body;
    const file = req.file;

    if (!description || !file) {
      return res.status(400).json({ message: "Description and file are required" });
    }

    const fileExt = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExt}`;
    const bucket = "research-files";

    // Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return res.status(500).json({ message: "File upload failed" });
    }

    // Get public URL
    const { data: publicUrlData } = supabase
      .storage
      .from(bucket)
      .getPublicUrl(fileName);

    const file_url = publicUrlData.publicUrl;

    // Save research record
    const { data, error } = await supabase.from("research").insert({
      description,
      file_url,
      user_id: req.user.id,
    }).select().single();

    if (error) {
      console.error("DB insert error:", error);
      return res.status(500).json({ message: "Research insert failed" });
    }

    // Add to logs
    await supabase.from("logs").insert({
      user_id: req.user.id,
      action: `Uploaded new research: ${description}`,
    });

    res.status(201).json({ message: "Upload successful", data });
  } catch (err) {
    console.error("Upload exception:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Add log entry
app.post("/api/log", verifyAuth, async (req, res) => {
  try {
    const { description, user_id } = req.body;

    if (!description || !user_id) {
      return res.status(400).json({ message: "Description and user_id are required" });
    }

    const newLog = { description, user_id };

    const { data, error } = await supabase.from("logs").insert(newLog).select().single();
    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all research for a specific user
app.get("/api/research", verifyAuth, async (req, res) => {
  try {
    const user_id = req.query.user_id;
    if (!user_id) {
      return res.status(400).json({ message: "user_id query param is required" });
    }

    const { data, error } = await supabase
      .from("research")
      .select("id, description, file_url, created_at")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Optional: Endpoint to verify token & return current user info
app.get("/api/me", verifyAuth, async (req, res) => {
  try {
    const { id } = req.user;
    const { data, error } = await supabase.from("profiles").select("id, name, email").eq("id", id).single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
