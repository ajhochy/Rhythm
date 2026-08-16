# Architecture

The project is a React 18 and TypeScript single-page prototype built by Vite. Hash routes select deterministic product pages. Page components own fixture-backed state and append visible endpoint receipts to demonstrate intended API behavior without external writes. Shared shell, dialog, icon, and task components live under `src/components/`; each product page keeps its detailed interaction contract in `src/pages/<page>/index.tsx` and scoped CSS.

