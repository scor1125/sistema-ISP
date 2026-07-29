import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Auth relies on httpOnly cookies set by the backend on /auth/login.
// We never store JWTs in localStorage (XSS attack surface).
export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export function formatApiError(e) {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || "Error";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(" ");
  return JSON.stringify(d);
}
