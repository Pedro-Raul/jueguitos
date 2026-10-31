type Props = {
  title: string
  message?: string | null
  actionLabel: string
  onAction: () => void
}

export function MessageScreen({ title, message, actionLabel, onAction }: Props) {
  return (
    <main className="screen">
      <section className="card">
        <h1>{title}</h1>
        {message ? <p className="muted">{message}</p> : null}
        <div className="actions">
          <button className="primary" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      </section>
    </main>
  )
}
