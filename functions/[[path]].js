const LAMBDA_ORIGIN = 'https://l4e3dtacfzcaaexcdlhfqln3qy0gdfpf.lambda-url.ap-northeast-2.on.aws';

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  if (!incoming.pathname.startsWith('/api/') && !incoming.pathname.startsWith('/auth/')) {
    return context.next();
  }
  const target = `${LAMBDA_ORIGIN}${incoming.pathname}${incoming.search}`;
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.delete('origin');

  const response = await fetch(target, {
    method: context.request.method,
    headers,
    body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
    redirect: 'manual'
  });

  const outputHeaders = new Headers(response.headers);
  outputHeaders.delete('access-control-allow-origin');
  outputHeaders.delete('access-control-allow-credentials');
  outputHeaders.delete('access-control-allow-methods');
  outputHeaders.delete('access-control-allow-headers');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outputHeaders
  });
}
