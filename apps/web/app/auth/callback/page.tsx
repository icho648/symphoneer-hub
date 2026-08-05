"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "../../../lib/supabase";

export default function AuthCallback() {
  const [message, setMessage] = useState("Completing sign-in…");
  useEffect(() => {
    const code = new URL(window.location.href).searchParams.get("code");
    if (!code) {
      setMessage("Missing OAuth code.");
      return;
    }
    void getSupabaseClient()
      .auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) throw error;
        window.location.replace("/");
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Sign-in failed"));
  }, []);
  return <main className="center-card"><p>{message}</p></main>;
}
