const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const FEED_COLUMNS = 'slug, title, suburb, state, published_at, teaser, open_count';
const FULL_COLUMNS = FEED_COLUMNS + ', body';

async function list() {
  const { data, error } = await supabase
    .from('whispers')
    .select(FEED_COLUMNS)
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function get(slug) {
  const { data, error } = await supabase
    .from('whispers')
    .select(FULL_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Returns the new count, or null if the slug does not exist.
async function increment(slug) {
  const { data, error } = await supabase.rpc('increment_open', { p_slug: slug });
  if (error) throw error;
  return data;
}

async function insert(row) {
  const { data, error } = await supabase
    .from('whispers')
    .insert(row)
    .select(FULL_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

// Edits the text fields only. Slug (so share links keep working) and open count stay as they are.
async function update(slug, fields) {
  const { data, error } = await supabase
    .from('whispers')
    .update(fields)
    .eq('slug', slug)
    .select(FULL_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function remove(slug) {
  const { data, error } = await supabase
    .from('whispers')
    .delete()
    .eq('slug', slug)
    .select('slug');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { list, get, increment, insert, update, remove };
