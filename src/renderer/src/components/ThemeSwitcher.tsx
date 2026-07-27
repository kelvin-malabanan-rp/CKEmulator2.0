import { THEMES, type Theme } from '../uiSettings';
import { IconMoon, IconMoonStars, IconSun } from './icons';

const ICON: Record<Theme, (p: { className?: string }) => JSX.Element> = {
  dark: IconMoon,
  dimmed: IconMoonStars,
  light: IconSun,
};

const TITLE: Record<Theme, string> = {
  dark: 'Dark theme',
  dimmed: 'Dimmed theme',
  light: 'Light theme',
};

/**
 * Icon-only theme switch: moon / moon-stars / sun. The active mode's icon sits
 * on a solid accent pill; inactive icons are muted with no background. No text
 * labels (titles/aria carry the meaning).
 */
export function ThemeSwitcher({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}): JSX.Element {
  return (
    <div className="themeswitch" role="group" aria-label="Colour theme">
      {THEMES.map((t) => {
        const Icon = ICON[t];
        return (
          <button
            key={t}
            className={`themeicon${theme === t ? ' on' : ''}`}
            title={TITLE[t]}
            aria-label={TITLE[t]}
            aria-pressed={theme === t}
            onClick={() => onChange(t)}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
