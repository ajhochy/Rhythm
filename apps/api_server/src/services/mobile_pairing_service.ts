import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { AppError } from '../errors/app_error';
import { MobileDevicesRepository } from '../repositories/mobile_devices_repository';
import type { MobileDeviceRecord } from '../repositories/mobile_devices_repository';

export const MOBILE_GATEWAY_COMPATIBILITY = {
  gatewayVersion: '1',
  rhythmVersion: '0.1.0',
  opencodeVersion: '1.14.49',
  contractFingerprint: 'fd0aae2af9c69775409c399056cffeb39fd1f248f56abff7dae391895ca1add8',
  features: [
    'pairing',
    'device-revocation',
    'project-scope',
    'opencode-http-proxy',
    'opencode-sse-proxy',
    'opencode-pty-proxy',
  ],
  minimumMobileVersion: '0.1.0',
};

function verifier(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export type MobileDevice = Omit<MobileDeviceRecord, 'tokenVerifier'>;

function withoutVerifier(device: MobileDeviceRecord): MobileDevice {
  const { tokenVerifier: _tokenVerifier, ...safeDevice } = device;
  return safeDevice;
}

export interface MobilePairingServiceOptions {
  repository: MobileDevicesRepository;
  hostId: string;
  now?: () => Date;
  pairingCodeTtlMs?: number;
}

export class MobilePairingService {
  private readonly repository: MobileDevicesRepository;
  private readonly hostId: string;
  private readonly now: () => Date;
  private readonly pairingCodeTtlMs: number;

  constructor(options: MobilePairingServiceOptions) {
    this.repository = options.repository;
    this.hostId = options.hostId;
    this.now = options.now ?? (() => new Date());
    this.pairingCodeTtlMs = options.pairingCodeTtlMs ?? 5 * 60_000;
  }

  createPairingCode(userId: number): {
    id: string;
    hostId: string;
    pairingCode: string;
    expiresAt: string;
  } {
    const createdAt = this.now();
    const pairingCode = randomBytes(32).toString('base64url');
    const result = {
      id: randomUUID(),
      hostId: this.hostId,
      pairingCode,
      expiresAt: new Date(createdAt.getTime() + this.pairingCodeTtlMs).toISOString(),
    };

    this.repository.insertPairingCode({
      id: result.id,
      hostId: result.hostId,
      userId,
      codeVerifier: createHash('sha256').update(pairingCode).digest('hex'),
      expiresAt: result.expiresAt,
      consumedAt: null,
      createdAt: createdAt.toISOString(),
    });

    return result;
  }

  pair(input: { pairingCode: string; userId: number; deviceName: string }): {
    deviceId: string;
    hostId: string;
    deviceToken: string;
    gatewayVersion: string;
    rhythmVersion: string;
    opencodeVersion: string;
    contractFingerprint: string;
    features: string[];
    minimumMobileVersion: string;
  } {
    const presentedVerifier = verifier(input.pairingCode);
    const pairingCode = this.repository.listPairingCodes().find((candidate) => {
      const storedVerifier = Buffer.from(candidate.codeVerifier, 'hex');
      return storedVerifier.length === presentedVerifier.length &&
        timingSafeEqual(storedVerifier, presentedVerifier);
    });
    if (!pairingCode) throw AppError.unauthorized('Invalid pairing code');
    if (pairingCode.userId !== input.userId) {
      throw AppError.forbidden('Pairing code belongs to a different Rhythm user');
    }
    const pairedAt = this.now();
    if (pairedAt.getTime() >= new Date(pairingCode.expiresAt).getTime()) {
      throw AppError.unauthorized('Pairing code has expired');
    }

    const createdAt = pairedAt.toISOString();
    const deviceToken = randomBytes(32).toString('base64url');
    const deviceId = randomUUID();
    const consumed = this.repository.consumePairingCodeAndCreateDevice(
      pairingCode.id,
      {
        id: deviceId,
        hostId: pairingCode.hostId,
        userId: input.userId,
        name: input.deviceName,
        tokenVerifier: verifier(deviceToken).toString('hex'),
        revokedAt: null,
        createdAt,
      },
      createdAt,
    );
    if (!consumed) throw AppError.conflict('Pairing code has already been used');

    return {
      deviceId,
      hostId: pairingCode.hostId,
      deviceToken,
      ...MOBILE_GATEWAY_COMPATIBILITY,
      features: [...MOBILE_GATEWAY_COMPATIBILITY.features],
    };
  }

  health(): typeof MOBILE_GATEWAY_COMPATIBILITY & { status: 'ready'; hostId: string } {
    return {
      status: 'ready',
      hostId: this.hostId,
      ...MOBILE_GATEWAY_COMPATIBILITY,
    };
  }

  listDevices(userId: number): MobileDevice[] {
    return this.repository.listDevices(userId).map(withoutVerifier);
  }

  revokeDevice(deviceId: string, userId: number): boolean {
    return this.repository.revokeDevice(deviceId, userId, this.now().toISOString());
  }

  authenticateDevice(deviceToken: string): MobileDevice | null {
    const presentedVerifier = verifier(deviceToken);
    const device = this.repository
      .listDevices()
      .filter((candidate) => candidate.revokedAt === null)
      .find((candidate) => {
        const storedVerifier = Buffer.from(candidate.tokenVerifier, 'hex');
        return storedVerifier.length === presentedVerifier.length &&
          timingSafeEqual(storedVerifier, presentedVerifier);
      });
    return device ? withoutVerifier(device) : null;
  }
}
