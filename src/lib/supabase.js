const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("supabase: SUPABASE_URL or SUPABASE_SERVICE_KEY not set; license DB operations disabled.");
}

const supabase =
  supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

function getSupabase() {
  return supabase;
}

module.exports = { supabase, getSupabase };
