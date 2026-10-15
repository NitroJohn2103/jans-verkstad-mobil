# Jans verkstad – mobilapp

Öppna appen: https://NitroJohn2103.github.io/jans-verkstad-mobil/

Mobilanpassat register över verktyg och förvaringsplatser. Foto kan tas med mobilens kamera eller väljas från bildbiblioteket. Sök på namn, sökord och plats.

## Viktigt om lagring

All data, inklusive foton, lagras i webbläsaren på enheten. Den synkroniseras inte med andra telefoner och raderas om webbläsardata för webbplatsen rensas. Exportera en säkerhetskopia regelbundet och före telefonbyte. Använd Återställ från fil för att flytta registret till en annan enhet. Import ersätter det lokala registret.

Appen kan läggas på hemskärmen via webbläsarens meny. När den har laddats första gången kan den öppnas offline med service worker. Första besöket kräver uppkoppling.

## Utveckling

Källkod finns i `src/`. Installera Node.js 22.13 eller senare. Kör `npm install`, därefter `npm run build`. GitHub Pages publicerar innehållet i `dist/` från `main`-grenen. `dist/` är byggda filer och ligger i repot för enkel publicering. Kör om bygget efter källkodsändringar och lägg upp både källkod och ändrade dist-filer.
