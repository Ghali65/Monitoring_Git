"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { verifyAdminCredentials } from "../actions/adminAction";

export function AdminPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = await verifyAdminCredentials(login, password);

    if (result.success && result.url) {
      window.open(result.url, "_blank");
      setIsOpen(false);
      setLogin("");
      setPassword("");
      setError("");
    } else {
      setError("Identifiants incorrects.");
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        style={{
          textDecoration: 'none',
          color: 'var(--text-main, var(--fg, #000))',
          fontWeight: 600,
          fontSize: '0.88rem',
          padding: '9px 18px',
          background: 'rgba(249,115,22,0.06)',
          borderRadius: '12px',
          border: '1px solid rgba(249,115,22,0.2)',
          transition: 'all 0.25s ease',
          cursor: 'pointer',
          marginRight: '12px'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(249,115,22,0.1)';
          e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(249,115,22,0.06)';
          e.currentTarget.style.borderColor = 'rgba(249,115,22,0.2)';
        }}
      >
        Admin
      </button>

      {isOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999,
        }}>
          <div style={{
            background: "var(--bg, #fff)",
            color: "var(--fg, #000)",
            padding: "24px",
            borderRadius: "12px",
            width: "300px",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            position: "relative"
          }}>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--fg, #000)"
              }}
            >
              <X size={20} />
            </button>
            <h2 style={{ marginTop: 0, marginBottom: "20px", fontSize: "1.2rem" }}>Accès Admin</h2>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9rem" }}>Login</label>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "1px solid var(--border, #ccc)",
                    background: "var(--bg, #fff)",
                    color: "var(--fg, #000)",
                    boxSizing: "border-box"
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9rem" }}>Mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "1px solid var(--border, #ccc)",
                    background: "var(--bg, #fff)",
                    color: "var(--fg, #000)",
                    boxSizing: "border-box"
                  }}
                />
              </div>
              {error && <p style={{ color: "red", margin: 0, fontSize: "0.85rem" }}>{error}</p>}
              <button
                type="submit"
                style={{
                  padding: "10px",
                  background: "var(--primary, #f97316)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  marginTop: "8px"
                }}
              >
                Valider
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
