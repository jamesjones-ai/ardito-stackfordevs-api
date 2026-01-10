-- PayForeman AI Database Schema
-- Construction collections tracking system for Colorado subcontractors

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  phone VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_name VARCHAR(255) NOT NULL,
  general_contractor VARCHAR(255) NOT NULL,
  project_address TEXT,
  project_city VARCHAR(100),
  project_state VARCHAR(2) DEFAULT 'CO',
  project_type VARCHAR(50) CHECK (project_type IN ('private', 'public')),
  work_start_date DATE,
  work_end_date DATE,
  project_status VARCHAR(50) DEFAULT 'active' CHECK (project_status IN ('active', 'completed', 'on_hold')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  project_name VARCHAR(255),
  general_contractor VARCHAR(255),
  category VARCHAR(100),
  invoice_number VARCHAR(100) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  retainage_percent DECIMAL(5, 2) DEFAULT 0,
  retainage_amount DECIMAL(12, 2) DEFAULT 0,
  amount_paid DECIMAL(12, 2) DEFAULT 0,
  payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid', 'overdue')),
  paid_date DATE,
  description TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payments table - tracks payment history for invoices
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  payment_method VARCHAR(50),
  check_number VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deadlines table - tracks lien filing and preliminary notice deadlines
CREATE TABLE IF NOT EXISTS deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  deadline_type VARCHAR(100) NOT NULL CHECK (deadline_type IN ('preliminary_notice', 'mechanics_lien', 'retainage_release', 'payment_bond_claim', 'custom')),
  deadline_date DATE NOT NULL,
  trigger_date DATE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  notes TEXT,
  completed_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat history table - stores AI chat conversations
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Colorado lien law rules reference table
CREATE TABLE IF NOT EXISTS colorado_lien_rules (
  id SERIAL PRIMARY KEY,
  rule_type VARCHAR(100) NOT NULL,
  project_type VARCHAR(20) NOT NULL CHECK (project_type IN ('private', 'public')),
  deadline_days INTEGER NOT NULL,
  description TEXT NOT NULL,
  trigger_event VARCHAR(255) NOT NULL,
  statutory_reference VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert Colorado lien law rules
INSERT INTO colorado_lien_rules (rule_type, project_type, deadline_days, description, trigger_event, statutory_reference)
VALUES
  ('preliminary_notice', 'private', 10, 'Preliminary notice must be sent within 10 days of first furnishing labor or materials', 'first_work_date', 'C.R.S. § 38-22-109'),
  ('mechanics_lien', 'private', 120, 'Mechanics lien must be filed within 4 months (120 days) from the last day labor or materials were furnished', 'last_work_date', 'C.R.S. § 38-22-109'),
  ('mechanics_lien', 'public', 120, 'Payment bond claim must be made within 4 months from last furnishing', 'last_work_date', 'C.R.S. § 38-26-107'),
  ('retainage_release', 'private', 60, 'Retainage typically released 30-60 days after project completion', 'project_completion', 'Contract Terms')
ON CONFLICT DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_user_id ON deadlines(user_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_date ON deadlines(deadline_date);
CREATE INDEX IF NOT EXISTS idx_deadlines_status ON deadlines(status);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_deadlines_updated_at ON deadlines;
CREATE TRIGGER update_deadlines_updated_at BEFORE UPDATE ON deadlines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
