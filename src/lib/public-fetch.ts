import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as fetchPinned } from "undici";

export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function publicUrl(input: string | URL) {
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    (!host.includes(".") && !host.includes(":")) ||
    /(?:^|\.)(?:localhost|local|internal)$/i.test(host) ||
    (ipaddr.isValid(host) && !publicAddress(host))
  )
    throw new Error("URL publique HTTP(S) requise.");
  return url;
}
async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
// Resolve every hop, reject any private answer, and pin the approved IP for the
// connection itself. A second DNS resolution cannot redirect us to a private IP.
export function createPublicFetch({
  resolve = (host: string) => lookup(host, { all: true }),
  send = fetchPinned,
}: {
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
  send?: typeof fetchPinned;
} = {}): typeof fetch {
  return async (input, init) => {
    let url = publicUrl(input instanceof Request ? input.url : String(input));
    for (let redirects = 0; redirects <= 3; redirects++) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = ipaddr.isValid(host)
        ? [
            {
              address: host,
              family: ipaddr.process(host).kind() === "ipv6" ? 6 : 4,
            },
          ]
        : await abortable(resolve(host), init?.signal);
      if (
        !addresses.length ||
        addresses.some((value) => !publicAddress(value.address))
      )
        throw new Error("Adresse réseau non autorisée.");
      const pinned = addresses[0];
      const agent = new Agent({
        connect: {
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          },
        },
      });
      try {
        const response = await send(url, {
          method: "GET",
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            "accept-encoding": "identity",
          },
          signal: init?.signal,
          redirect: "manual",
          dispatcher: agent,
        });
        if (
          [301, 302, 303, 307, 308].includes(response.status) &&
          response.headers.get("location")
        ) {
          await response.body?.cancel();
          await agent.close();
          if (redirects === 3) throw new Error("Trop de redirections.");
          url = publicUrl(new URL(response.headers.get("location")!, url));
          continue;
        }
        // Keep the dispatcher alive while streaming; release it once consumption ends.
        const reader = response.body?.getReader();
        const stream = reader
          ? new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const next = await reader.read();
                  if (next.done) {
                    controller.close();
                    await agent.close();
                  } else controller.enqueue(next.value);
                } catch (error) {
                  controller.error(error);
                  await agent.destroy();
                }
              },
              async cancel() {
                await reader.cancel();
                await agent.destroy();
              },
            })
          : null;
        if (!reader) await agent.close();
        const result = new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers),
        });
        Object.defineProperty(result, "url", { value: url.toString() });
        return result;
      } catch (error) {
        await agent.destroy();
        throw error;
      }
    }
    throw new Error("Trop de redirections.");
  };
}
export const publicFetch = createPublicFetch();
