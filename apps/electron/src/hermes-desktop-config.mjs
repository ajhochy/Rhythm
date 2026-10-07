// Update this only with the corresponding reviewed embedded artifact source.
// Runtime checks prevent a mutable local Hermes installation from being loaded.
export const PINNED_HERMES_DESKTOP_SOURCE_COMMIT = '13ade17847a0225dc95b79d9ed5c9c6afc8bc083';

// Ed25519 release key (issue-1570). The private half is only the CI secret
// HERMES_DESKTOP_MANIFEST_SIGNING_KEY; add a key here before rotating it, remove the old one after.
/** @type {readonly string[]} */
export const HERMES_DESKTOP_UPDATE_PUBLIC_KEYS = Object.freeze([
    '-----BEGIN PUBLIC KEY-----\n' +
    'MCowBQYDK2VwAyEAjidRmAIdnyxRi7gXe3NuNI6OcSMQlHyDOssEXgiwmF4=\n' +
    '-----END PUBLIC KEY-----\n',
]);
export const HERMES_DESKTOP_MINIMUM_VERSION = '0.20.5';
export const HERMES_DESKTOP_SUPPORTED_HOST_API_VERSIONS = Object.freeze([1]);
