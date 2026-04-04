type SearchResult = {
  title: string
  link: string
  snippet: string
  date: string
  display_link: string
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MiniCode/0.1'

export async function searchDuckDuckGoLite(options: {
  query: string
  maxResults?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
}): Promise<{
  organic: SearchResult[]
  base_resp: { status_code: number; status_msg: string; source: string }
}> {
  const url = new URL('https://lite.duckduckgo.com/lite/')
  url.searchParams.set('q', options.query)

  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  })

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}`)
  }

  const html = await response.text()
  const allowed = normalizeDomainList(options.allowedDomains)
  const blocked = normalizeDomainList(options.blockedDomains)
  const maxResults = options.maxResults ?? 5

  const organic = parseDuckDuckGoLite(html)
    .filter((r) => passesDomainFilter(r.link, allowed, blocked))
    .slice(0, maxResults)

  return {
    organic,
    base_resp: {
      status_code: response.status,
      status_msg: response.statusText,
      source: 'duckduckgo-lite',
    },
  }
}

export async function fetchWebPage(options: {
  url: string
  maxChars?: number
}): Promise<{
  url: string
  finalUrl: string
  status: number
  statusText: string
  contentType: string
  title: string | null
  content: string
}> {
  const response = await fetch(options.url, {
    headers: {
      'user-agent': USER_AGENT,
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  })

  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const finalUrl = response.url || options.url
  const maxChars = options.maxChars ?? 12000

  if (contentType.includes('html')) {
    return {
      url: options.url,
      finalUrl,
      status: response.status,
      statusText: response.statusText,
      contentType,
      title: extractTitle(text),
      content: extractReadableText(text).slice(0, maxChars),
    }
  }

  return {
    url: options.url,
    finalUrl,
    status: response.status,
    statusText: response.statusText,
    contentType,
    title: null,
    content: text.slice(0, maxChars),
  }
}

function parseDuckDuckGoLite(html: string): SearchResult[] {
  const linkPattern =
    /<a rel="nofollow" href="([^"]+)" class='result-link'>([\s\S]*?)<\/a>/giu
  const matches = [...html.matchAll(linkPattern)]
  const results: SearchResult[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (!match) continue

    const nextMatch = matches[i + 1]
    const block = html.slice(match.index ?? 0, nextMatch?.index ?? html.length)

    const rawHref = match[1] ?? ''
    const title = decodeHtml(stripTags(match[2] ?? ''))
    const snippet = decodeHtml(
      stripTags(firstMatch(/<td class='result-snippet'>\s*([\s\S]*?)\s*<\/td>/iu, block) ?? ''),
    )
    const displayLink = decodeHtml(
      stripTags(firstMatch(/<span class='link-text'>([\s\S]*?)<\/span>/iu, block) ?? ''),
    )
    const link = normalizeDuckDuckGoLink(rawHref)

    if (!title || !link) continue
    results.push({ title, link, snippet, date: '', display_link: displayLink })
  }

  return results
}

function normalizeDomainList(domains: string[] | undefined): string[] {
  return (domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)
}

function passesDomainFilter(
  link: string,
  allowed: string[],
  blocked: string[],
): boolean {
  let host = ''
  try {
    host = new URL(link).hostname.toLowerCase()
  } catch {
    return false
  }
  if (blocked.some((d) => matchesDomain(host, d))) return false
  if (allowed.length === 0) return true
  return allowed.some((d) => matchesDomain(host, d))
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function firstMatch(pattern: RegExp, text: string): string | null {
  return text.match(pattern)?.[1] ?? null
}

function normalizeDuckDuckGoLink(rawHref: string): string {
  const href = decodeHtml(rawHref).trim()
  if (!href) return ''
  const absolute = href.startsWith('//') ? `https:${href}` : href
  try {
    const url = new URL(absolute)
    const redirect = url.searchParams.get('uddg')
    return redirect ? decodeURIComponent(redirect) : url.toString()
  } catch {
    return absolute
  }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)
  return match ? decodeHtml(stripTags(match[1] ?? '')).trim() : null
}

function extractReadableText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/giu, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/giu, ' ')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&#x2F;/gu, '/')
    .replace(/&#47;/gu, '/')
    .replace(/&nbsp;/gu, ' ')
}
