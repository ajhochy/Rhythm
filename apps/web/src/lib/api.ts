import axios from 'axios';

const defaultBaseUrl =
  import.meta.env.PROD && !import.meta.env.DEV
    ? 'https://api.vcrcapps.com'
    : 'http://localhost:4000';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? defaultBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

export default api;
