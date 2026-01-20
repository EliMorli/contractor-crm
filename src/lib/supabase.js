import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Using local storage fallback.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Schema version for migrations
const SCHEMA_VERSION = 2;

// Migrate data from v1 (original) to v2 (PRD v3 with modes)
const migrateData = (data) => {
  const currentVersion = data.schemaVersion || 1;

  if (currentVersion >= SCHEMA_VERSION) {
    return data; // Already up to date
  }

  console.log(`Migrating data from schema v${currentVersion} to v${SCHEMA_VERSION}`);

  // Migrate from v1 to v2
  if (currentVersion < 2) {
    data.projects = (data.projects || []).map(project => ({
      ...project,
      // Migrate categories to all-inclusive mode
      categories: (project.categories || []).map(cat => ({
        ...cat,
        mode: 'all-inclusive',
        totalBudget: cat.clientBudget ?? cat.totalBudget ?? 0,
        totalCost: cat.yourCost ?? cat.totalCost ?? 0,
        laborBudget: null,
        laborCost: null,
        materialsBudget: null,
        // Migrate expenses to have null type (all-inclusive doesn't need type)
        expenses: (cat.expenses || []).map(exp => ({
          ...exp,
          type: exp.type || null,
          paymentMethod: exp.paymentMethod || null,
          reference: exp.reference || null
        })),
        // Allocations: ensure amount field exists
        allocations: (cat.allocations || []).map(alloc => ({
          ...alloc,
          amount: alloc.amount ?? 0,
          laborAmount: alloc.laborAmount || null,
          materialsAmount: alloc.materialsAmount || null
        }))
      })),
      // Migrate payments
      payments: (project.payments || []).map(pay => ({
        ...pay,
        paymentMethod: pay.paymentMethod || 'check',
        reference: pay.reference || pay.checkNumber || '',
        // Migrate payment allocations
        allocations: (pay.allocations || []).map(alloc => ({
          ...alloc,
          amount: alloc.amount ?? 0,
          laborAmount: alloc.laborAmount || null,
          materialsAmount: alloc.materialsAmount || null
        }))
      }))
    }));
  }

  data.schemaVersion = SCHEMA_VERSION;
  return data;
};

// Database operations with localStorage fallback
export const db = {
  async getProjects() {
    if (supabase) {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          categories (
            *,
            allocations (*),
            expenses (*)
          ),
          payments (*)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching projects:', error);
        return [];
      }
      return data || [];
    }

    // localStorage fallback with migration
    const stored = localStorage.getItem('contractor-crm-data');
    if (stored) {
      let data = JSON.parse(stored);
      // Run migration if needed
      data = migrateData(data);
      // Save migrated data back
      localStorage.setItem('contractor-crm-data', JSON.stringify(data));
      return data.projects || [];
    }
    return [];
  },

  async saveProject(project) {
    if (supabase) {
      const { id, categories, payments, ...projectData } = project;

      // Upsert project
      const { data: savedProject, error } = await supabase
        .from('projects')
        .upsert({
          id: id || undefined,
          ...projectData
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving project:', error);
        return null;
      }

      return savedProject;
    }

    // localStorage fallback
    const stored = localStorage.getItem('contractor-crm-data');
    const data = stored ? JSON.parse(stored) : { projects: [] };

    const existingIndex = data.projects.findIndex(p => p.id === project.id);
    if (existingIndex >= 0) {
      data.projects[existingIndex] = project;
    } else {
      data.projects.push(project);
    }

    localStorage.setItem('contractor-crm-data', JSON.stringify(data));
    return project;
  },

  async deleteProject(projectId) {
    if (supabase) {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);

      if (error) {
        console.error('Error deleting project:', error);
        return false;
      }
      return true;
    }

    // localStorage fallback
    const stored = localStorage.getItem('contractor-crm-data');
    if (stored) {
      const data = JSON.parse(stored);
      data.projects = data.projects.filter(p => p.id !== projectId);
      localStorage.setItem('contractor-crm-data', JSON.stringify(data));
    }
    return true;
  },

  async saveCategory(projectId, category) {
    if (supabase) {
      const { id, allocations, expenses, ...categoryData } = category;

      const { data, error } = await supabase
        .from('categories')
        .upsert({
          id: id || undefined,
          project_id: projectId,
          ...categoryData
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving category:', error);
        return null;
      }
      return data;
    }
    return category;
  },

  async deleteCategory(categoryId) {
    if (supabase) {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', categoryId);

      if (error) {
        console.error('Error deleting category:', error);
        return false;
      }
    }
    return true;
  },

  async savePayment(projectId, payment, allocations) {
    if (supabase) {
      const { id, ...paymentData } = payment;

      const { data: savedPayment, error: paymentError } = await supabase
        .from('payments')
        .upsert({
          id: id || undefined,
          project_id: projectId,
          ...paymentData
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Error saving payment:', paymentError);
        return null;
      }

      // Save allocations (supports both all-inclusive amount and separate labor/materials)
      if (allocations && allocations.length > 0) {
        const allocationsToSave = allocations
          .filter(a => (a.amount > 0) || (a.laborAmount > 0) || (a.materialsAmount > 0))
          .map(a => ({
            payment_id: savedPayment.id,
            category_id: a.categoryId,
            amount: a.amount || null,
            labor_amount: a.laborAmount || null,
            materials_amount: a.materialsAmount || null,
            date: payment.date
          }));

        const { error: allocError } = await supabase
          .from('allocations')
          .insert(allocationsToSave);

        if (allocError) {
          console.error('Error saving allocations:', allocError);
        }
      }

      return savedPayment;
    }
    return payment;
  },

  async deletePayment(paymentId) {
    if (supabase) {
      // Allocations will be deleted by CASCADE
      const { error } = await supabase
        .from('payments')
        .delete()
        .eq('id', paymentId);

      if (error) {
        console.error('Error deleting payment:', error);
        return false;
      }
    }
    return true;
  },

  async saveExpense(categoryId, expense) {
    if (supabase) {
      const { id, ...expenseData } = expense;

      const { data, error } = await supabase
        .from('expenses')
        .upsert({
          id: id || undefined,
          category_id: categoryId,
          amount: expenseData.amount,
          date: expenseData.date,
          description: expenseData.description,
          type: expenseData.type || null,
          payment_method: expenseData.paymentMethod || null,
          reference: expenseData.reference || null
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving expense:', error);
        return null;
      }
      return data;
    }
    return expense;
  },

  async deleteExpense(expenseId) {
    if (supabase) {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', expenseId);

      if (error) {
        console.error('Error deleting expense:', error);
        return false;
      }
    }
    return true;
  }
};
