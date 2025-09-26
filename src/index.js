// src/pages/Home.jsx (or whatever file shows homepage)
import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import { Link } from "react-router-dom";

export default function Home() {
  const [user, setUser] = useState(null);
  const [members, setMembers] = useState([]);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    supabase.auth.getUser().then((res) => {
      if (res.data.user) setUser(res.data.user);
    });
    fetchMembers();
    fetchNotifications();
    // Listen for auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setUser(session.user);
      else setUser(null);
    });
    return () => {
      sub.subscription?.unsubscribe();
    };
  }, []);

  async function fetchMembers() {
    const { data } = await supabase.from("members").select("*").limit(6);
    if (data) setMembers(data);
  }
  async function fetchNotifications() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setNotifications(data);
  }

  return (
    <div className="page">
      <header className="hero">
        <img src="/novaedge-icon.png" alt="Icon" className="hero-icon" />
        <div>
          <h1>NovaEdge Research Portal</h1>
          <p>A rising star with sharp vision, breaking limits and driving unstoppable growth.</p>
        </div>
      </header>

      {!user && (
        <div className="alert">
          Please <Link to="/login">login</Link> to continue.
        </div>
      )}

      <section>
        <h3>Members</h3>
        <div className="grid">
          {members.map((m) => (
            <Link key={m.id} to={`/member/${m.id}`} className="card member-card">
              <img
                src={m.avatar_url || "https://i.pravatar.cc/100"}
                alt={m.name}
                className="avatar"
              />
              <div>{m.name}</div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h3>Recent Updates</h3>
        <ul>
          {notifications.map((n) => (
            <li key={n.id}>{n.message}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

