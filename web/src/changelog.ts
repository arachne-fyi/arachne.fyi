/**
 * The changelog shown on /changelog. Newest first. Add an entry for every release; keep the
 * words plain, they are read by players, not developers.
 */
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  sections: { heading: 'Website' | 'Mod' | 'Server' | 'Privacy and security' | 'Fixes'; items: string[] }[];
}

export const CHANGELOG: Release[] = [
  {
    version: '2.0.0-alpha.3',
    date: '2026-11-17',
    title: 'Fixes, a widget Standby and a new icon',
    sections: [
      {
        heading: 'Website',
        items: [
          'New pixel spider icon.',
          'Standby is now a board of 1, 2, 4 or 6 widgets: profit, per hour, kills, week, time, fight timer, last drop, dry streak, a Bazaar price, a clock and a 24 hour profit line. Tap one to change it.',
          'Drops: things every kill gives (essence, string, eyes, soul string) show the average amount per kill next to the wiki amount, instead of a meaningless 100%.',
          "View as free user: Pro members and admins can see exactly what the free plan shows.",
          'Pick a title from the ones you have unlocked, in Settings.',
          'Value Arachne\'s Armor as the Spider Essence it salvages into (Settings).',
          'Public profiles can show each Minecraft account, and you choose every field that is public.',
          'Post to Discord sends a proper embed through your webhook.',
          'Shared links to profiles and groups show a preview card.',
          'Every on/off switch now looks and works the same, On on the left.',
        ],
      },
      {
        heading: 'Fixes',
        items: [
          'Leaderboard: switching tabs kept adding boxes to the podium.',
          'The stream overlay page stopped working after the overlay options were added.',
          'Opening a group invite link asked the server for the group non-stop, which could lock you out for a minute.',
          'The Feed page squeezed every drop into a narrow column.',
          'Long names, titles and big numbers no longer push pages wider than a phone screen; wide tables scroll inside their box.',
          'Phone notifications: an old browser subscription made for a previous server key is replaced instead of silently failing.',
          'A server hiccup on load now retries instead of showing "The server did not answer".',
        ],
      },
      {
        heading: 'Mod',
        items: ['Nothing from the Alpha network (alpha.hypixel.net) is recorded or counted.'],
      },
    ],
  },
  {
    version: '2.0.0-alpha.2',
    date: '2026-11-17',
    title: 'Arachne Ledger is now Arachne.fyi',
    sections: [
      {
        heading: 'Website',
        items: [
          'New name everywhere: Arachne.fyi.',
          'Home page shows how many coins, drops and Arachne kills Arachne.fyi has tracked across everyone.',
          'Groups: make a group, share its six-letter code or post an invite to Discord, up to 100 people. View the site as any group you are in.',
          'Group tags (2 to 4 letters) for the in-game badge.',
          'Free and Pro plans. Pro previews show what the locked charts look like using example numbers.',
          'Redeem codes for free Pro time.',
          'New Pro charts: where the profit came from, what a crystal returns, time up by account, kills against profit, and drops by value.',
          'Standby mode: lay your phone on its side and keep today\'s profit on screen.',
          'Stream overlay: pick what it shows, its size, layout and look.',
          'Background: moving panorama, still picture or a plain colour (Settings). The panorama only loads on a fast connection.',
          'A footer on every page with contact details and links.',
          'Links to other sites open in a new tab.',
          'This changelog.',
        ],
      },
      {
        heading: 'Privacy and security',
        items: [
          'Terms, privacy notice and cookie notice. You are asked to accept them once, and again only when they change.',
          'Choose whether other people can see your numbers. The anonymous totals on the home page always count everyone.',
          'Delete your account and data yourself from Settings, or ask at contact@arachne.fyi.',
          'Stricter browser security headers and request limits.',
        ],
      },
      {
        heading: 'Mod',
        items: [
          'Renamed to Arachne.fyi. The command is now /arachne; /ledger still works.',
          'Your settings, queue and local totals move over from the old folder by themselves.',
          'Can ask the site which nearby players use Arachne.fyi and which group tag they show.',
        ],
      },
    ],
  },
  {
    version: '2.0.0-alpha.1',
    date: '2026-11-16',
    title: 'The big dashboard update',
    sections: [
      {
        heading: 'Website',
        items: [
          'Drops page: how often each drop comes from callings and crystals next to the wiki chance, with a luck rating.',
          '"If you had sold differently" and today\'s Bazaar prices with a 24 hour change.',
          'Best hours to farm, farming-days calendar and damage per fight.',
          'Feed: drop of the week, everyone\'s rare drops with reactions and comments, and challenges.',
          'Progress: streaks, weekly quests, 18 badges and a collection book.',
          'Team goal, personal notifications (Discord or phone) and quiet hours.',
          'Installable app that opens offline with your last numbers; phone tab bar, Glance page and pull to refresh.',
          'Ctrl+K search, keyboard shortcuts, shareable graph links and a short first-login tour.',
          'Public calculators at /tools, and a viewer for the mod\'s local.json.',
          '"Your year" summary, public profile card and stream overlay.',
        ],
      },
      {
        heading: 'Mod',
        items: [
          'Pair with a six-letter code.',
          'Minimal, normal and full HUD styles, today\'s rank on the HUD and a once-a-day update check.',
          'Works without an invite: totals are kept on your PC.',
          'Debug line and a troubleshooting report that leaves your token out.',
        ],
      },
      {
        heading: 'Server',
        items: ['Restarts itself after a crash and keeps a log.', 'Nightly backups with a check that each one opens.'],
      },
    ],
  },
];
