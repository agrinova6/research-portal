import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../utils/supabaseClient";

export default function MemberPage() {
  const { id } = useParams();
  const [member, setMember] = useState(null);
  const [works, setWorks] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [reloginPass, setReloginPass] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchMember();
    fetchWorks();
  }, [id]);

  async function fetchMember() {
    const { data } = await supabase.from("members").select("*").eq("id", id).single();
    setMember(data);
  }
  async function fetchWorks() {
    const { data } = await supabase
      .from("research")
      .select("*")
      .eq("member_id", id)
      .order("created_at", { ascending: false });
    if (data) setWorks(data);
  }

  function openUpload() {
    setShowUpload(true);
    setMessage("");
  }

  async function handleUpload(e) {
    e.preventDefault();
    setMessage("");

    // Re-login by checking password
    const { data, error } = await supabase.auth.signInWithPassword({
      email: member.email,
      password: reloginPass,
    });
    if (error) {
      setMessage("Re-login failed: " + error.message);
      return;
    }

    // Upload file if present
    let file_url = null;
    if (file) {
      const path = `${id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("research-files")
        .upload(path, file);
      if (upErr) {
        setMessage("File upload failed: " + upErr.message);
        return;
      }
      const { data: pub } = supabase.storage.from("research-files").getPublicUrl(path);
      file_url = pub.publicUrl;
    }

    // Insert research record
    const { error: insErr } = await supabase.from("research").insert([
      {
        member_id: id,
        title,
        description: desc,
        link,
        file_url,
      },
    ]);
    if (insErr) {
      setMessage("Save failed: " + insErr.message);
    } else {
      setMessage("Uploaded successfully");
      fetchWorks();
      setShowUpload(false);
    }
  }

  if (!member) return <div>Loading...</div>;

  return (
    <div className="page">
      <div className="member-header">
        <img
          src={member.avatar_url || "https://i.pravatar.cc/100"}
          alt={member.name}
          className="avatar-lg"
        />
        <h2>{member.name}</h2>
      </div>

      <button onClick={openUpload} className="btn">
        Upload / Update Research (requires re-login)
      </button>

      {showUpload && (
        <form onSubmit={handleUpload} className="card upload-form">
          <h3>Re-login & Upload</h3>
          <label>Password</label>
          <input
            type="password"
            value={reloginPass}
            onChange={(e) => setReloginPass(e.target.value)}
            required
          />
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <label>Description</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          ></textarea>
          <label>External Link</label>
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <label>File (pdf, image)</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files[0])}
          />
          <button type="submit" className="btn">
            Upload
          </button>
          {message && <p className="muted">{message}</p>}
        </form>
      )}

      <section>
        <h3>Research Works</h3>
        {works.length === 0 ? (
          <p>No research works yet.</p>
        ) : (
          works.map((w) => (
            <div className="card work" key={w.id}>
              <strong>{w.title}</strong>
              <p>{w.description}</p>
              {w.link && (
                <a href={w.link} target="_blank" rel="noreferrer">
                  View Link
                </a>
              )}
              {w.file_url && (
                <a
                  href={w.file_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download File
                </a>
              )}
              <div className="small muted">
                {new Date(w.created_at).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

