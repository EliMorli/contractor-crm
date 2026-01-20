import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Using local storage fallback.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

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

    // localStorage fallback
    const stored = localStorage.getItem('contractor-crm-data');
    if (stored) {
      const data = JSON.parse(stored);
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

      // Save allocations
      if (allocations && allocations.length > 0) {
        const allocationsToSave = allocations
          .filter(a => a.amount > 0)
          .map(a => ({
            payment_id: savedPayment.id,
            category_id: a.categoryId,
            amount: a.amount,
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
          ...expenseData
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
