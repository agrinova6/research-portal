import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";

dotenv.config();

const app = express();


app.use(cors({
 // origin: "https://your-netlify-site.netlify.app" 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Auth middleware
async function verifyAuth(req, res, next) {
  const { authorization } = req.headers;
  if (!authorization) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authorization.split(" ")[1];
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid token" });
  }
  req.user = data.user;
  next();
}



// Signup
app.post("/api/signup", async (req, res) => {
  const { email, password, name } = req.body;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    user_metadata: { name }
  });
  if (error) return res.status(400).json({ error: error.message });
  await supabase.from("profiles").insert({ id: data.user.id, name, email });
  res.json({ user: data.user });
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });
  res.json(data.session);
});

// Get members
app.get("/api/members", verifyAuth, async (req, res) => {
  const { data, error } = await supabase.from("profiles").select("id, name");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get research logs for a member
app.get("/api/research/:memberId", verifyAuth, async (req, res) => {
  const { memberId } = req.params;
  const { data, error } = await supabase
    .from("research")
    .select("id, user_id, description, file_url")
    .eq("user_id", memberId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Upload research (file + description)
app.post(
  "/api/upload",
  verifyAuth,
  upload.single("file"),
  async (req, res) => {
    const description = req.body.description;
    const file = req.file;
    const user = req.user;

    if (req.body.user_id && req.body.user_id !== user.id) {
      return res.status(403).json({ error: "Cannot upload to another user" });
    }

    try {
      const filePath = `${user.id}/${Date.now()}_${file.originalname}`;
      const { error: storageErr } = await supabase.storage
        .from("research")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype
        });

      if (storageErr) {
        throw storageErr;
      }

      const { data: urlData } = supabase.storage
        .from("research")
        .getPublicUrl(filePath);

      const { error: insertErr } = await supabase.from("research").insert([
        {
          user_id: user.id,
          description,
          file_url: urlData.publicUrl
        }
      ]);

      if (insertErr) {
        throw insertErr;
      }

      await supabase.from("logs").insert([
        {
          user_id: user.id,
          action: `Member uploaded new research`
        }
      ]);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

// Fetch logs
app.get("/api/logs", verifyAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("logs")
    .select("user_id, action, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
