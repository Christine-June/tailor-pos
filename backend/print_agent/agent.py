#!/usr/bin/env python3
"""TailorPOS print agent. Runs on a PC in the shop and needs only Python's standard library.

The cloud server cannot reach a printer on the shop's private network, so this agent makes
an outbound HTTPS connection, collects queued jobs and sends them to the local printer.

    python agent.py --server https://pos.example.com --token <TOKEN> --printer-host 192.168.1.50
    python agent.py --server https://pos.example.com --token <TOKEN> --windows-printer "EPSON TM-T20"

--windows-printer sends RAW data to a USB printer through its Windows driver (needs: pip install pywin32).
"""
import argparse
import base64
import json
import logging
import socket
import sys
import time
import urllib.error
import urllib.request

log = logging.getLogger("print-agent")


def send_tcp(host: str, port: int, payload: bytes, timeout: float = 10.0) -> None:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(payload)


def send_windows(printer_name: str, payload: bytes) -> None:
    import win32print  # type: ignore[import-not-found]

    handle = win32print.OpenPrinter(printer_name)
    try:
        win32print.StartDocPrinter(handle, 1, ("TailorPOS", None, "RAW"))
        try:
            win32print.StartPagePrinter(handle)
            win32print.WritePrinter(handle, payload)
            win32print.EndPagePrinter(handle)
        finally:
            win32print.EndDocPrinter(handle)
    finally:
        win32print.ClosePrinter(handle)


class Client:
    def __init__(self, server: str, token: str):
        self.server = server.rstrip("/")
        self.token = token

    def _post(self, path: str, body: dict | None = None):
        request = urllib.request.Request(
            self.server + path,
            data=json.dumps(body or {}).encode(),
            headers={"X-Agent-Token": self.token, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status == 204:
                return None
            return json.loads(response.read())

    def claim(self):
        return self._post("/api/print-agent/jobs/claim")

    def ack(self, job_id: str, ok: bool, error: str | None = None) -> None:
        self._post(f"/api/print-agent/jobs/{job_id}/ack", {"ok": ok, "error": error})


def run_once(client: Client, printer) -> bool:
    """Handles one job. Returns True if there was one."""
    job = client.claim()
    if job is None:
        return False
    try:
        printer(base64.b64decode(job["payload_b64"]))
    except Exception as err:  # any printer failure goes back to the server for a retry
        log.warning("job %s failed: %s", job["id"], err)
        client.ack(job["id"], False, str(err)[:300])
        return False  # pause before retrying: the printer is probably out of paper or off
    client.ack(job["id"], True)
    log.info("printed %s %s", job["document"], job["id"])
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--printer-host")
    parser.add_argument("--printer-port", type=int, default=9100)
    parser.add_argument("--windows-printer")
    parser.add_argument("--interval", type=float, default=2.0, help="seconds between checks when idle")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if bool(args.printer_host) == bool(args.windows_printer):
        parser.error("choose exactly one of --printer-host or --windows-printer")
    if args.printer_host:
        printer = lambda payload: send_tcp(args.printer_host, args.printer_port, payload)  # noqa: E731
    else:
        printer = lambda payload: send_windows(args.windows_printer, payload)  # noqa: E731

    client = Client(args.server, args.token)
    log.info("print agent started, polling %s", args.server)
    backoff = args.interval
    while True:
        try:
            if run_once(client, printer):
                continue  # more jobs may be waiting
            backoff = args.interval
        except urllib.error.HTTPError as err:
            if err.code == 401:
                log.error("the server rejected this token; generate a new one in Settings")
                return 1
            log.warning("server returned %s", err.code)
            backoff = min(backoff * 2, 60)
        except (urllib.error.URLError, OSError, TimeoutError) as err:
            log.warning("can't reach the server: %s", err)
            backoff = min(backoff * 2, 60)
        time.sleep(backoff)


if __name__ == "__main__":
    sys.exit(main())
