import fs from 'fs';
import os from 'os';
import path from 'path';

export function installInternalCaFromEnv(serverCerts?: string[], clientKey?: string[], clientCert?: string[]): void {
    let pem: string | undefined;
    if (serverCerts?.length) {
        pem = serverCerts.join('\n\n');
    } else {
        const raw = JSON.parse(process.env.INTERNAL_CA_BUNDLE_PEMS || 'null') as string[] | null;
        if (raw?.length) {
            pem = raw.join('\n\n');
        }
    }

    if (pem) {
        const caPath = path.join(os.tmpdir(), 'internal-ca-bundle.pem');
        fs.writeFileSync(caPath, pem, { mode: 0o600 });

        process.env.OTEL_EXPORTER_OTLP_CERTIFICATE = caPath;
        process.env.OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE = caPath;
    }

    if (clientKey && clientCert && clientKey.length > 0 && clientCert.length > 0) {
        const clientKeyPath = path.join(os.tmpdir(), 'internal-client-key.pem');
        fs.writeFileSync(clientKeyPath, clientKey.join('\n\n'), { mode: 0o600 });
        process.env.OTEL_EXPORTER_OTLP_CLIENT_KEY = clientKeyPath;

        const clientCertPath = path.join(os.tmpdir(), 'internal-client-cert.pem');
        fs.writeFileSync(clientCertPath, clientCert.join('\n\n'), { mode: 0o600 });
        process.env.OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE = clientCertPath;
    }
}
