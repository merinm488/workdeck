// Older bookmarks may still load the static account page before the Holm
// app router. Move them to the signed-in home (or its sign-in flow).
location.replace('/home');
