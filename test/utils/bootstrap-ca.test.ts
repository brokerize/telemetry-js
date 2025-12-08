import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installInternalCaFromEnv } from '../../src/util/bootstrap-ca.ts';

describe('installInternalCaFromEnv', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
        delete process.env.OTEL_EXPORTER_OTLP_CERTIFICATE;
        delete process.env.INTERNAL_CA_BUNDLE_PEMS;
    });

    afterEach(() => {
        // zur Sicherheit wieder zurücksetzen
        process.env = { ...originalEnv };
    });

    it('writes a bundle and sets OTEL_EXPORTER_OTLP_CERTIFICATE when certPems argument is provided', () => {
        const tmpDir = '/tmp/test-ca';
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        vi.spyOn(os, 'tmpdir').mockReturnValue(tmpDir);

        const certs = ['CERT1', 'CERT2'];

        installInternalCaFromEnv(certs);

        const expectedPath = path.join(tmpDir, 'internal-ca-bundle.pem');

        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(writeSpy).toHaveBeenCalledWith(expectedPath, 'CERT1\n\nCERT2', { mode: 0o600 });

        expect(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE).toBe(expectedPath);
    });

    it('reads certificates from INTERNAL_CA_BUNDLE_PEMS (JSON array) when certPems is not set', () => {
        const tmpDir = '/tmp/test-ca';
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        vi.spyOn(os, 'tmpdir').mockReturnValue(tmpDir);

        process.env.INTERNAL_CA_BUNDLE_PEMS = JSON.stringify(['CA_A', 'CA_B']);

        installInternalCaFromEnv();

        const expectedPath = path.join(tmpDir, 'internal-ca-bundle.pem');

        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(writeSpy).toHaveBeenCalledWith(expectedPath, 'CA_A\n\nCA_B', { mode: 0o600 });

        expect(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE).toBe(expectedPath);
    });

    it('does nothing when neither certPems is set nor INTERNAL_CA_BUNDLE_PEMS is present', () => {
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

        installInternalCaFromEnv();

        expect(writeSpy).not.toHaveBeenCalled();
        expect(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE).toBeUndefined();
    });

    it('does nothing when INTERNAL_CA_BUNDLE_PEMS is an empty array', () => {
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        process.env.INTERNAL_CA_BUNDLE_PEMS = JSON.stringify([]);

        installInternalCaFromEnv();

        expect(writeSpy).not.toHaveBeenCalled();
        expect(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE).toBeUndefined();
    });
    it('writes client key and cert when provided', () => {
        const tmpDir = '/tmp/test-ca';
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        vi.spyOn(os, 'tmpdir').mockReturnValue(tmpDir);

        const serverCerts = ['CERT1'];
        const clientKey = ['CLIENT_KEY_PART1', 'CLIENT_KEY_PART2'];
        const clientCert = ['CLIENT_CERT_PART1', 'CLIENT_CERT_PART2'];

        installInternalCaFromEnv(serverCerts, clientKey, clientCert);

        const expectedCaPath = path.join(tmpDir, 'internal-ca-bundle.pem');
        const expectedClientKeyPath = path.join(tmpDir, 'internal-client-key.pem');
        const expectedClientCertPath = path.join(tmpDir, 'internal-client-cert.pem');

        expect(writeSpy).toHaveBeenCalledWith(expectedCaPath, 'CERT1', { mode: 0o600 });
        expect(writeSpy).toHaveBeenCalledWith(expectedClientKeyPath, 'CLIENT_KEY_PART1\n\nCLIENT_KEY_PART2', {
            mode: 0o600
        });
        expect(writeSpy).toHaveBeenCalledWith(expectedClientCertPath, 'CLIENT_CERT_PART1\n\nCLIENT_CERT_PART2', {
            mode: 0o600
        });

        expect(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE).toBe(expectedCaPath);
        expect(process.env.OTEL_EXPORTER_OTLP_CLIENT_KEY).toBe(expectedClientKeyPath);
        expect(process.env.OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE).toBe(expectedClientCertPath);
    });
    it('does not write client key and cert when they are not provided', () => {
        const tmpDir = '/tmp/test-ca';
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        vi.spyOn(os, 'tmpdir').mockReturnValue(tmpDir);

        const serverCerts = ['CERT1'];

        installInternalCaFromEnv(serverCerts);

        const expectedCaPath = path.join(tmpDir, 'internal-ca-bundle.pem');

        expect(writeSpy).toHaveBeenCalledWith(expectedCaPath, 'CERT1', { mode: 0o600 });

        expect(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE).toBe(expectedCaPath);
        expect(process.env.OTEL_EXPORTER_OTLP_CLIENT_KEY).toBeUndefined();
        expect(process.env.OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE).toBeUndefined();
    });
    it('does not write client key and cert when they are empty arrays', () => {
        const tmpDir = '/tmp/test-ca';
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        vi.spyOn(os, 'tmpdir').mockReturnValue(tmpDir);

        const serverCerts = ['CERT1'];
        const clientKey: string[] = [];
        const clientCert: string[] = [];

        installInternalCaFromEnv(serverCerts, clientKey, clientCert);

        const expectedCaPath = path.join(tmpDir, 'internal-ca-bundle.pem');

        expect(writeSpy).toHaveBeenCalledWith(expectedCaPath, 'CERT1', { mode: 0o600 });

        expect(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE).toBe(expectedCaPath);
        expect(process.env.OTEL_EXPORTER_OTLP_CLIENT_KEY).toBeUndefined();
        expect(process.env.OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE).toBeUndefined();
    });
});
