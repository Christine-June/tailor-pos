import { useEffect, useState } from "react"
import { Check, Copy, KeyRound, Loader2, Printer, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import type { PrintJob, Shop } from "@/lib/types"
import { cn } from "@/lib/utils"
import { sessionUpdated } from "@/store/authSlice"
import { useAppDispatch, useAppSelector } from "@/store"
import { Field, Section } from "./ShopSettings"

const MODES: { mode: Shop["printer_mode"]; label: string; hint: string }[] = [
  { mode: "none", label: "No thermal printer", hint: "Print receipts and job cards from the browser to any printer." },
  { mode: "agent", label: "Printer in the shop (recommended)", hint: "A small program on a shop computer collects print jobs. Works with a cloud server." },
  { mode: "network", label: "Server prints directly", hint: "Only when the server itself runs inside the shop, on the same network as the printer." },
]

const JOB_STATUS: Record<PrintJob["status"], string> = { queued: "Waiting", claimed: "Printing", done: "Printed", failed: "Failed" }

export function PrinterSettings() {
  const shop = useAppSelector((s) => s.auth.shop)!
  const user = useAppSelector((s) => s.auth.user)!
  const dispatch = useAppDispatch()
  const [mode, setMode] = useState(shop.printer_mode)
  const [width, setWidth] = useState(shop.printer_width)
  const [host, setHost] = useState(shop.printer_host ?? "")
  const [port, setPort] = useState(String(shop.printer_port))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [confirmToken, setConfirmToken] = useState(false)
  const [jobs, setJobs] = useState<PrintJob[] | null>(null)
  const [copied, setCopied] = useState(false)

  const loadJobs = () =>
    api
      .get<{ items: PrintJob[] }>("/print/jobs")
      .then((r) => setJobs(r.items))
      .catch(() => setJobs([]))
  useEffect(() => {
    void loadJobs()
  }, [])

  const update = (saved: Shop) => dispatch(sessionUpdated({ user, shop: saved }))

  async function save() {
    const portNumber = Number(port)
    if (mode === "network" && (!host.trim() || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535)) {
      setMessage({ text: "Enter the printer's IP address and port (usually 9100).", ok: false })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const saved = await api.patch<Shop>("/settings/shop", {
        printer_mode: mode,
        printer_width: width,
        printer_host: mode === "network" ? host.trim() : shop.printer_host,
        printer_port: mode === "network" ? portNumber : shop.printer_port,
      })
      update(saved)
      setMessage({ text: "Printer settings saved.", ok: true })
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false })
    } finally {
      setBusy(false)
    }
  }

  async function newToken() {
    setConfirmToken(false)
    setBusy(true)
    try {
      const r = await api.post<{ token: string; shop: Shop }>("/settings/print-agent-token")
      update(r.shop)
      setMode("agent")
      setToken(r.token)
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false })
    } finally {
      setBusy(false)
    }
  }

  async function testPrint() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.post<{ status: string }>("/print/test")
      setMessage({ text: r.status === "queued" ? "Test page sent. It prints when the agent collects it (within a few seconds)." : "Test page printed.", ok: true })
      void loadJobs()
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false })
    } finally {
      setBusy(false)
    }
  }

  const command = `python agent.py --server ${window.location.origin} --token ${token ?? "<KEY>"} --printer-host 192.168.1.50`
  const changed = mode !== shop.printer_mode || width !== shop.printer_width || (mode === "network" && (host !== (shop.printer_host ?? "") || port !== String(shop.printer_port)))

  return (
    <div className="space-y-5">
      <Section title="Receipt printer">
        <fieldset className="space-y-2">
          <legend className="sr-only">How the shop prints</legend>
          {MODES.map((m) => (
            <label key={m.mode} className={cn("flex cursor-pointer gap-2 rounded-md border px-3 py-2", mode === m.mode && "border-primary bg-primary/5")}>
              <input type="radio" name="printer-mode" checked={mode === m.mode} onChange={() => setMode(m.mode)} className="mt-0.5 size-4" />
              <span className="text-sm">
                <span className="font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mode !== "none" && (
          <Field id="p-width" label="Paper width" hint="58 mm rolls are usually 32 characters, 80 mm rolls 42 or 48.">
            <select id="p-width" value={width} onChange={(e) => setWidth(Number(e.target.value) as Shop["printer_width"])} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm sm:w-64">
              <option value={32}>58 mm (32 characters)</option>
              <option value={42}>80 mm (42 characters)</option>
              <option value={48}>80 mm (48 characters)</option>
            </select>
          </Field>
        )}

        {mode === "network" && (
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field id="p-host" label="Printer IP address">
              <Input id="p-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
            </Field>
            <Field id="p-port" label="Port">
              <Input id="p-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
            </Field>
          </div>
        )}

        {mode === "agent" && (
          <div className="space-y-3 rounded-md bg-muted p-3 text-sm">
            <p>
              {shop.agent_configured ? (
                shop.agent_last_seen ? (
                  <>Agent last checked in {formatDateTime(shop.agent_last_seen, shop.timezone)}.</>
                ) : (
                  <>An agent key exists, but no agent has connected with it yet.</>
                )
              ) : (
                <>No agent connected yet. Create a key, then run the agent on the shop computer that can reach the printer.</>
              )}
            </p>
            <Button variant="outline" size="sm" onClick={() => (shop.agent_configured ? setConfirmToken(true) : void newToken())} disabled={busy}>
              <KeyRound /> {shop.agent_configured ? "Create a new key" : "Create agent key"}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {message && (
            <p role="status" className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>
              {message.text}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            {shop.printer_mode !== "none" && !changed && (
              <Button variant="outline" onClick={() => void testPrint()} disabled={busy}>
                <Printer /> Print a test page
              </Button>
            )}
            <Button onClick={() => void save()} disabled={busy || !changed}>
              {busy && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </Section>

      {shop.printer_mode !== "none" && (
        <Section title="Recent print jobs">
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void loadJobs()}>
              <RefreshCw /> Refresh
            </Button>
          </div>
          {!jobs ? (
            <div className="h-16 animate-pulse rounded-md bg-muted" />
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing printed yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                  <span className="font-medium capitalize">{j.document.replace("_", " ")}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(j.created_at, shop.timezone)}</span>
                  <span className={cn("ml-auto text-xs font-medium", j.status === "failed" ? "text-destructive" : j.status === "done" ? "text-success" : "text-warning-foreground")}>
                    {JOB_STATUS[j.status]}
                  </span>
                  {j.error && <span className="w-full text-xs text-destructive">{j.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Dialog
        open={confirmToken}
        onClose={() => setConfirmToken(false)}
        title="Create a new agent key?"
        description="The agent running now stops printing until it is restarted with the new key."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmToken(false)}>
              Keep the current key
            </Button>
            <Button onClick={() => void newToken()}>Create new key</Button>
          </>
        }
      >
        <p className="text-sm">Do this if the old key was shared by mistake or the shop computer was replaced.</p>
      </Dialog>

      <Dialog
        open={token !== null}
        onClose={() => setToken(null)}
        title="Agent key created"
        description="Copy it now. For safety it is shown only once."
        className="sm:max-w-xl"
        footer={<Button onClick={() => setToken(null)}>Done</Button>}
      >
        <div className="space-y-3 text-sm">
          <p>
            On the shop computer, install Python 3, copy <code>backend/print_agent/agent.py</code> from the project, and run (change the IP address to the printer's):
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">{command}</pre>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(command).then(() => setCopied(true))
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy command"}
          </Button>
          <p className="text-xs text-muted-foreground">
            For a USB printer on Windows, use <code>--windows-printer "Printer name"</code> instead of <code>--printer-host</code> (needs <code>pip install pywin32</code>).
          </p>
        </div>
      </Dialog>
    </div>
  )
}
