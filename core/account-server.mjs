/**
 * The address of Riwaq's account service (server/accounts, docs/ACCOUNTS.md):
 * the "riwaq-accounts" Worker on the project's workers.dev subdomain. Only
 * this constant, or RIWAQ_ACCOUNT_SERVER where a build or a test sets it,
 * chooses the server; the interface never can. An empty value turns
 * accounts off (the page then says they are coming and nothing is sent).
 */
export const ACCOUNT_SERVER = "https://riwaq-accounts.abadiosa2007.workers.dev";
