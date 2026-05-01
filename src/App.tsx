function App() {
  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-50">
      <div className="mx-auto flex min-h-[488px] w-full max-w-sm flex-col rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
              StreamPeek
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white">Hover previews for Twitch</h1>
          </div>
          <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
            MV3
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-300">
          StreamPeek overlays a lightweight live player on Twitch directory cards so you can peek
          into a stream without leaving the grid.
        </p>

        <section className="mt-6 grid gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
              What it does
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-200">
              <li>Detects live Twitch cards from stable preview-link selectors</li>
              <li>Autoplays muted HLS previews when you hover a live card</li>
              <li>Lets you unmute or adjust volume from the overlay controls</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-cyan-200">
              Safety net
            </p>
            <p className="mt-3 text-sm leading-6 text-cyan-50">
              If Twitch blocks the custom preview path, StreamPeek can fall back to an embedded
              player instead of leaving a broken card overlay behind.
            </p>
          </div>
        </section>

        <div className="mt-auto rounded-2xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-400">
          Load the unpacked extension, open a Twitch category page, and hover a live thumbnail to
          try the preview flow.
        </div>
      </div>
    </main>
  )
}

export default App
