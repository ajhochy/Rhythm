// React 19's `act` (and React 18.3's, which now re-exports the same primitive) refuses to run
// outside an explicitly declared test environment. Without this flag every mount below throws.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
