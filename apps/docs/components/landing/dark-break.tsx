import Link from "next/link";

export function DarkBreak() {
  return (
    <section className="bg-ink-black py-32">
      <div className="mx-auto max-w-[1200px] px-6 text-center">
        <div className="mx-auto inline-block overflow-hidden rounded-md">
          <div className="flex items-center justify-center bg-ink-black">
            <div className="relative w-[640px] overflow-hidden rounded-md border border-slate">
              <div className="flex items-center gap-[6px] bg-obsidian px-4 py-3">
                <div className="h-3 w-3 rounded-full bg-stone" />
                <div className="h-3 w-3 rounded-full bg-stone" />
                <div className="h-3 w-3 rounded-full bg-stone" />
                <span className="ml-4 font-booton text-caption text-ash-gray">
                  architecture — betterpush flow
                </span>
              </div>
              <div className="flex items-center justify-center bg-obsidian px-8 pb-8 pt-6">
                <svg width="520" height="200" viewBox="0 0 520 200" fill="none" className="text-stone">
                  <rect x="10" y="40" width="140" height="120" rx="6" stroke="currentColor" strokeWidth="1" fill="none" />
                  <text x="80" y="85" textAnchor="middle" fill="currentColor" fontSize="13" fontFamily="system-ui">Your App</text>
                  <text x="80" y="105" textAnchor="middle" fill="#80807c" fontSize="11" fontFamily="system-ui">ReadableStream</text>

                  <rect x="190" y="40" width="140" height="120" rx="6" stroke="currentColor" strokeWidth="1" fill="none" />
                  <text x="260" y="85" textAnchor="middle" fill="currentColor" fontSize="13" fontFamily="system-ui">BetterPush</text>
                  <text x="260" y="105" textAnchor="middle" fill="#80807c" fontSize="11" fontFamily="system-ui">Middleware</text>

                  <rect x="370" y="20" width="140" height="60" rx="6" stroke="#71eaee" strokeWidth="1" fill="none" />
                  <text x="440" y="50" textAnchor="middle" fill="#71eaee" fontSize="13" fontFamily="system-ui">Driver</text>
                  <text x="440" y="67" textAnchor="middle" fill="#80807c" fontSize="11" fontFamily="system-ui">Local / S3 / CDN</text>

                  <rect x="370" y="100" width="140" height="60" rx="6" stroke="#5c5c5c" strokeWidth="1" strokeDasharray="3 2" fill="none" />
                  <text x="440" y="133" textAnchor="middle" fill="#80807c" fontSize="11" fontFamily="system-ui">read / delete / url</text>

                  <line x1="150" y1="100" x2="188" y2="100" stroke="#80807c" strokeWidth="1" />
                  <polygon points="186,96 196,100 186,104" fill="#80807c" />

                  <line x1="330" y1="60" x2="368" y2="60" stroke="#71eaee" strokeWidth="1" />
                  <polygon points="366,56 376,60 366,64" fill="#71eaee" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-10">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-md border border-paper-white px-6 py-3 font-booton text-body-sm font-[575] text-paper-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            View Documentation
          </Link>
        </div>
      </div>
    </section>
  );
}
