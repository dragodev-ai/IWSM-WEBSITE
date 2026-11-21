-- ==============================================================================
-- IWSM Website: Supabase Leads Database Schema
-- Run this script in your Supabase Project SQL Editor (supabase.com -> SQL Editor)
-- ==============================================================================

-- 1. Create the 'leads' table
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    course TEXT DEFAULT 'Gamma Plan — 100 Days Complete Mastery (Flagship)',
    source TEXT DEFAULT 'IWSM Official Website Hero Form',
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'counselled', 'enrolled', 'closed')),
    notes TEXT,
    ip_address TEXT,
    user_agent TEXT
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Allow anonymous website visitors to insert validated new leads only
DROP POLICY IF EXISTS "Allow public anon form submissions" ON public.leads;
CREATE POLICY "Allow public anon form submissions"
ON public.leads
FOR INSERT
TO anon
WITH CHECK (
    char_length(trim(full_name)) BETWEEN 2 AND 120
    AND phone ~ '^[6-9][0-9]{9}$'
    AND (email IS NULL OR char_length(email) <= 254)
    AND status = 'new'
);

-- 4. Policy: Only MFA-verified (aal2) staff/admin roles can view or update leads
DROP POLICY IF EXISTS "Allow authenticated staff to view leads" ON public.leads;
DROP POLICY IF EXISTS "Allow authenticated staff to update leads" ON public.leads;
DROP POLICY IF EXISTS "Allow staff only to view leads" ON public.leads;
DROP POLICY IF EXISTS "Allow staff only to update leads" ON public.leads;

CREATE POLICY "Allow staff only to view leads"
ON public.leads
FOR SELECT
TO authenticated
USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    AND (auth.jwt() ->> 'aal') = 'aal2'
);

CREATE POLICY "Allow staff only to update leads"
ON public.leads
FOR UPDATE
TO authenticated
USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    AND (auth.jwt() ->> 'aal') = 'aal2'
)
WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    AND (auth.jwt() ->> 'aal') = 'aal2'
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status);

-- Output confirmation
COMMENT ON TABLE public.leads IS 'Stores incoming student inquiries and admission counselling requests from iwsm.edu.in';
