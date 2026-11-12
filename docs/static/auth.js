/* Supabase auth handling for the login/register page.
   Uses the global `supabase` from the UMD bundle loaded in auth.html,
   and SUPABASE_URL / SUPABASE_ANON_KEY from config.js. */
const $ = (id) => document.getElementById(id);
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(location.search);
const isRegister = params.get("mode") === "register";

$("mode-title").textContent = isRegister ? "Create account" : "Log in";
$("submit-btn").textContent = isRegister ? "Register" : "Log in";
$("switch-line").innerHTML = isRegister
  ? 'Have an account? <a href="auth.html">Log in</a>'
  : 'No account? <a href="auth.html?mode=register">Register</a>';
/* Name is asked only when creating an account. */
if (isRegister) {
  $("name").style.display = "";
  $("password").setAttribute("autocomplete", "new-password");
}

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("msg").textContent = "";
  $("msg").style.color = ""; // reset to the default red for errors
  /* No local email validation — Supabase validates the address and we
     display its message directly. */
  const email = $("email").value.trim();
  const password = $("password").value;
  const name = $("name").value.trim();

  if (isRegister && !name) {
    $("msg").textContent = "Please enter your name.";
    return;
  }
  if (!password) {
    $("msg").textContent = "Please enter a password.";
    return;
  }

  $("submit-btn").disabled = true;
  try {
    const { data, error } = isRegister
      ? await sb.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        })
      : await sb.auth.signInWithPassword({ email, password });

    if (error) {
      $("msg").textContent = error.message;
    } else if (data.session) {
      /* Success (sign-up or sign-in): the session is stored automatically
         by the Supabase client, so the user stays logged in even after
         closing the browser. Go straight to the app. */
      location.href = "app.html";
    } else {
      /* Sign-up succeeded but no session: email confirmation is enabled
         on this Supabase project. */
      $("msg").style.color = "var(--ok)";
      $("msg").textContent =
        "Account created! Check your email to confirm, then log in.";
      isRegister = false; // flip the form back to log-in mode
      $("mode-title").textContent = "Log in";
      $("submit-btn").textContent = "Log in";
      $("name").style.display = "none";
    }
  } catch (err) {
    $("msg").textContent = "Connection error: " + err.message;
  }
  $("submit-btn").disabled = false;
});

/* Session persistence: the Supabase client stores the session in
   localStorage, so this check keeps the user logged in across browser
   restarts — a returning user goes straight to the app. */
sb.auth.getSession().then(({ data }) => {
  if (data.session) location.href = "app.html";
});

/* If the session expires or is revoked while the page is open, send the
   user back to the login page instead of failing silently. */
sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && !location.pathname.endsWith("auth.html")) {
    location.href = "auth.html";
  }
});
