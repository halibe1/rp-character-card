/*
 * Настройки общего сервера. Пока supabaseUrl / supabaseKey пустые, сайт работает локально:
 * персонажи хранятся в браузере. Как включить общий сервер — см. раздел «Сервер для игроков» в NOTES.md.
 * Ключ anon публичный: он виден в браузере по определению, защиту обеспечивают правила в supabase/schema.sql.
 * Секретный ключ (service_role) сюда класть НЕЛЬЗЯ.
 */
(window.RP_DATA = window.RP_DATA || {}).config = {
  "supabaseUrl": "",
  "supabaseKey": "",
  "maxCharactersPerUser": 5,
  "maxArtMB": 10
};
