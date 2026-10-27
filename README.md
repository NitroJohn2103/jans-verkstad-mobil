# Jans verkstad – mobilapp

Öppna appen: https://nitrojohn2103.github.io/jans-verkstad-mobil/

Mobilanpassat register över verktyg och förvaringsplatser. Ta ett foto med mobilen och sök på namn, sökord eller plats.

## Lagring och säkerhetskopia

Verktygsregistret sparas lokalt och har separat molnsynkronisering via Supabase när den har anslutits. Exportera ändå regelbundet en säkerhetskopia innan du byter enhet eller rensar webbläsardata.

**Projekt & ritningar** sparas i en egen lokal databas och en privat Supabase-lagringsyta `jans-projekt`. Denna gren innehåller en första försiktig automatisk projektsynkronisering:

- Automatisk synkronisering är **avstängd tills den aktiveras manuellt** på varje enhet med knappen på sidan *Projekt & ritningar*. När den är aktiverad kontrollerar appen molnkopian vid öppning, återanslutning, ny aktivitet och under användning.
- Nya projekt och bilagor och ändringar som endast gjorts på en sida kan föras över automatiskt.
- Samtidiga motstridiga ändringar stoppas. Raderingar förs inte över automatiskt.
- Versionshistorik och äldre tidsstämplade kopior bevaras. En kopia får vara högst 25 MB.
- Inloggning krävs. Synkronisering sker inte kontinuerligt när iOS stängt webbappen.

Behåll manuella molnkopior och separata exporter som extra säkerhet. Testa iPhone och Mac med testprojekt innan denna gren tas i bruk.

## Användning

Öppna länken i mobilens webbläsare. Lägg den på hemskärmen via webbläsarens delningsmeny. Första besöket kräver internet; appen kan därefter användas offline när dess filer har lagrats.

## Källkod

Källkoden finns i [source-code.zip](./source-code.zip). Packa upp den, installera Node.js 22.13 eller senare och kör `npm install` samt `npm run build`. GitHub Pages serverar de byggda filerna direkt från repots rot på grenen `main`.
