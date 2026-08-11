import { baseRegisterType, isLoaRegisterType } from '../../../core/posTypes';
import type { Theme } from '../uiSettings';
import type { useEmulator } from '../useEmulator';
import { ConnectionStatus } from './ConnectionStatus';
import { ThemeSwitcher } from './ThemeSwitcher';
import { IconPlug } from './icons';

/**
 * Slim (~48px) top bar: app name + tenant/store code (muted mono), the
 * collapsed connection status, and the single Connect/Disconnect primary
 * action. Locale (CA lanes only) and the icon-only theme switch sit in the
 * right cluster. Connection SETUP (register type, host, player key) lives in
 * the Config tab (bottom-right quadrant), not here — this bar stays minimal.
 */
export function TopBar({
  e,
  theme,
  setTheme,
}: {
  e: ReturnType<typeof useEmulator>;
  theme: Theme;
  setTheme: (t: Theme) => void;
}): JSX.Element {
  const locale = e.snapshot.locale;
  const base = baseRegisterType(e.config.registerType);
  const bilingual = base !== 'radiant6-us' && base !== 'verifone-topaz';
  const isLoa = isLoaRegisterType(e.config.registerType);

  // Store/tenant identity: the registered player code + tenant when known,
  // else fall back to the host so the bar always shows what it's pointed at.
  const storeCode = e.globalInit
    ? `${e.globalInit.playerCode} · ${e.globalInit.tenant}`
    : e.config.host;

  return (
    <header className="topbar">
      <div className="brand">
        <strong>CKEmulator&nbsp;2.0</strong>
        <span className="store" title="Player code · tenant">{storeCode}</span>
      </div>

      <ConnectionStatus e={e} />

      <div className="topactions">
        {bilingual && (
          <div className="locale">
            <button className={locale === 'en' ? 'on' : ''} onClick={() => e.setLocale('en')}>EN-CA</button>
            <button className={locale === 'fr' ? 'on' : ''} onClick={() => e.setLocale('fr')}>FR-CA</button>
          </div>
        )}
        <ThemeSwitcher theme={theme} onChange={setTheme} />
        {e.attempted ? (
          <button
            className="connbtn"
            onClick={() => void e.disconnect()}
            title={isLoa ? 'Unload the embedded player' : 'Close the hardware connection'}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="connbtn primary"
            onClick={() => void e.connect()}
            title={isLoa ? 'Load / re-boot the embedded player (recovers a stuck player)' : 'Open the TCP hardware connection to the player'}
          >
            <IconPlug className="connbtnicon" />
            Connect
          </button>
        )}
      </div>
    </header>
  );
}
