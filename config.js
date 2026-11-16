// Prime Journal – Verbindung zur Cloud-Datenbank (Supabase)
// Trage hier deine Werte aus Supabase ein: Project Settings → API (bzw. "Data API" / "API Keys").
// Der "anon public" Key darf öffentlich sein. Deine Daten schützt die Datenbank über den Login (Row Level Security).
// Lässt du beide Felder leer, läuft das Journal lokal im Browser; die Werte kannst du dann auch in der App unter Einstellungen eintragen.
window.PJ_CONFIG = {
  supabaseUrl: "",   // z. B. "https://abcdefgh.supabase.co"
  supabaseKey: ""    // z. B. "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
};
