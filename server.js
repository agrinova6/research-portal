import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import dayjs from "dayjs";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const app = express();
app.use(cors({
  origin: ['http://localhost:80', 'https://rescuevault-portal.netlify.app'],
  credentials: true
}));
app.use(express.json());

// ENV Vars
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY missing in env");
}

// Supabase admin client (service role)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ✅ New Middleware to verify token using Supabase
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization header missing or invalid" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("Token verification failed:", err);
    res.status(401).json({ message: "Token verification failed" });
  }
};

// Expose anon key + URL for frontend
app.get("/api/anon-key", (req, res) => {
  res.json({ anonKey: supabaseAnonKey, supabaseUrl });
});

// Login route
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
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

    res.json({ access_token: data.access_token, user: data.user });
  } catch (err) {
    console.error("Unexpected error in login:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

// Get list of members
app.get("/api/members", verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("profiles").select("id, name");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Research summary
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

// Add research record without file
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

// Multer setup for memory storage and file validation
const storage = multer.memoryStorage();

const allowedMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, images, DOC, and TXT files are allowed."));
    }
  },
});

// File upload route
app.post("/api/upload", verifyAuth, upload.single("file"), async (req, res) => {
  try {
    const { description } = req.body;
    const file = req.file;

    if (!description || description.trim() === "") {
      return res.status(400).json({ message: "Description is required" });
    }

    let file_url = null;

    if (file) {
      const fileExt = path.extname(file.originalname).toLowerCase();
      if (!fileExt) {
        return res.status(400).json({ message: "File extension missing or invalid" });
      }

      const fileName = `${uuidv4()}${fileExt}`;
      const bucket = "research-files";

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

      const { data: publicUrlData, error: publicUrlError } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      if (publicUrlError) {
        console.error("Error getting public URL:", publicUrlError);
        return res.status(500).json({ message: "Failed to get public file URL" });
      }

      file_url = publicUrlData.publicUrl;
    }

    const { data, error } = await supabase
      .from("research")
      .insert({
        description,
        file_url,
        user_id: req.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("DB insert error:", error);
      return res.status(500).json({ message: "Research insert failed" });
    }

    await supabase.from("logs").insert({
      user_id: req.user.id,
      action: `Uploaded new research: ${description}`,
    });

    res.status(201).json({ message: "Upload successful", data });
  } catch (err) {
    console.error("Upload exception:", err);
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Add log entry
app.post("/api/log", verifyAuth, async (req, res) => {
  try {
    const { description, user_id } = req.body;

    if (!description || !user_id) {
      return res.status(400).json({ message:
