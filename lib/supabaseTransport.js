// Keep browser HTTP traffic on the app origin. The server rewrite forwards it
// to the configured Supabase project with the caller's original credentials.
export function createSupabaseFetch(projectUrl, {
  getOrigin = () => typeof window === "undefined" ? null : window.location.origin,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const project = new URL(projectUrl);
  return (input, init) => {
    const origin = getOrigin();
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = new URL(isRequest ? input.url : String(input), project);
    if (!origin || url.origin !== project.origin ||
        !/^\/(auth|rest|storage)\/v1\//.test(url.pathname)) {
      return fetchImpl(input, init);
    }
    const target = `${origin}/api/supabase${url.pathname}${url.search}`;
    return fetchImpl(isRequest ? new Request(target, input) : target, init);
  };
}
