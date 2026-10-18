/**
 * Host half: inert.
 *
 * Everything this package presents lives in the browser half: it replaces the
 * composer's model seat and reads subscription usage that
 * `dsh-plugin-subscriptions` already serves over the `subscriptions-auth` RPC
 * endpoints. The browser half is discovered from the `dsh.client` declaration
 * in package.json, so the node side only needs to exist for the Loader to have
 * something to mount.
 */
export function apply() {}
