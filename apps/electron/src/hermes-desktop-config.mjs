// Update this only with the corresponding reviewed embedded artifact source.
// Runtime checks prevent a mutable local Hermes installation from being loaded.
export const PINNED_HERMES_DESKTOP_SOURCE_COMMIT = '31b8917a6d0267e7cf15adbe57191dd39ac16a1c';

// TODO(issue-1570): AJ must replace this empty trust set with the release
// public key before installed artifact updates can be accepted.
/** @type {readonly string[]} */
export const HERMES_DESKTOP_UPDATE_PUBLIC_KEYS = Object.freeze([]);
export const HERMES_DESKTOP_MINIMUM_VERSION = '0.20.5';
export const HERMES_DESKTOP_SUPPORTED_HOST_API_VERSIONS = Object.freeze([1]);
