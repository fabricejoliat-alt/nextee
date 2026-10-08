# Supabase database CA

`supabase-prod-ca-2021.crt` is a public CA certificate, not a credential.

Source: the **Download certificate** link observed on 7 October 2026 in Database Settings → SSL configuration for the Zurich project `soivxpdcilgltbjbpimt`:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Official instructions: https://supabase.com/docs/guides/platform/ssl-enforcement

Certificate SHA256 fingerprint:

`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Certificate validity: 28 April 2021 to 26 April 2031.

The migration runner uses this CA only for its PostgreSQL connection, with `sslmode=verify-full`. It does not modify the system trust store or the server's SSL configuration. `PGSSLROOTCERT` remains an explicit override.

Verification: OpenSSL PostgreSQL STARTTLS handshake against `db.soivxpdcilgltbjbpimt.supabase.co:5432`, CA validation and exact hostname validation both enabled, returned `Verification: OK` with TLS 1.3. No database authentication or SQL command was sent.
