#!/usr/bin/env python3
"""Small App Store Connect helper for the MoneyMart iOS release (no third-party packages).

Usage:
  asc.py app <bundle-id>          print the App Store Connect app id for a bundle id (exit 2 if none)
  asc.py bundle <bundle-id>       print the registered Bundle ID resource id (exit 2 if none)
  asc.py next-build <app-id>      print the next free build number for that app

Credentials stay on this Mac and are never printed:
  ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8 and ~/.appstoreconnect/issuer_id
"""
import base64, json, os, subprocess, sys, time, urllib.parse, urllib.request

KEY_ID = os.environ.get("ASC_KEY_ID", "992P7733ZH")
KEY_PATH = os.path.expanduser(f"~/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8")
ISSUER = os.environ.get("ASC_ISSUER_ID") or open(os.path.expanduser("~/.appstoreconnect/issuer_id")).read().strip()
API = "https://api.appstoreconnect.apple.com/v1"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def token() -> str:
    header = b64u(json.dumps({"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(time.time())
    payload = b64u(json.dumps({"iss": ISSUER, "iat": now - 20, "exp": now + 600, "aud": "appstoreconnect-v1"}, separators=(",", ":")).encode())
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", KEY_PATH], input=f"{header}.{payload}".encode(),
                         capture_output=True, check=True).stdout
    # DER ECDSA signature -> raw r||s (JWS ES256).
    idx = 2 + (der[1] & 0x7F if der[1] & 0x80 else 0)
    r = der[idx + 2: idx + 2 + der[idx + 1]]
    i2 = idx + 2 + der[idx + 1]
    s = der[i2 + 2: i2 + 2 + der[i2 + 1]]
    raw = r.lstrip(b"\x00").rjust(32, b"\x00") + s.lstrip(b"\x00").rjust(32, b"\x00")
    return f"{header}.{payload}.{b64u(raw)}"


def get(path: str, params: dict) -> list:
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}"})
    with urllib.request.urlopen(request) as response:
        return json.load(response)["data"]


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    command, value = sys.argv[1], sys.argv[2]
    if command == "app":
        apps = get("apps", {"filter[bundleId]": value, "fields[apps]": "bundleId,name"})
        match = [a for a in apps if a["attributes"]["bundleId"] == value]
        if not match:
            sys.exit(2)
        print(match[0]["id"])
    elif command == "bundle":
        ids = get("bundleIds", {"filter[identifier]": value, "fields[bundleIds]": "identifier,name"})
        match = [b for b in ids if b["attributes"]["identifier"] == value]
        if not match:
            sys.exit(2)
        print(match[0]["id"])
    elif command == "next-build":
        builds = get("builds", {"filter[app]": value, "limit": 200, "fields[builds]": "version"})
        numbers = [int(b["attributes"]["version"]) for b in builds if b["attributes"]["version"].isdigit()]
        print(max(numbers, default=0) + 1)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
