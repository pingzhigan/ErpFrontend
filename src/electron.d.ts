export interface ElectronAPI {
  getBackendUrl: () => Promise<string>
  getClientMac: () => Promise<string | null>
  isElectron: true
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
