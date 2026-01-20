import React, { useState, useEffect } from 'react';
import { db } from './lib/supabase';
import './index.css';

const ContractorCRM = () => {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [showNewExpense, setShowNewExpense] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load data from database on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const loadedProjects = await db.getProjects();
        setProjects(loadedProjects);
        if (loadedProjects.length > 0) {
          setSelectedProject(loadedProjects[0].id);
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      }
      setIsLoading(false);
    };
    loadData();
  }, []);

  // Save data whenever projects change
  useEffect(() => {
    if (!isLoading && projects.length > 0) {
      // For localStorage fallback, save all data
      localStorage.setItem('contractor-crm-data', JSON.stringify({ projects }));
    }
  }, [projects, isLoading]);

  const currentProject = projects.find(p => p.id === selectedProject);

  // Calculate totals for a category
  const getCategoryTotals = (category) => {
    const clientPaid = category.allocations?.reduce((sum, a) => sum + a.amount, 0) || 0;
    const youPaid = category.expenses?.reduce((sum, e) => sum + e.amount, 0) || 0;
    const remaining = category.clientBudget - clientPaid;
    const yourRemaining = category.yourCost - youPaid;
    const profit = clientPaid - youPaid;
    const projectedProfit = category.clientBudget - category.yourCost;

    return { clientPaid, youPaid, remaining, yourRemaining, profit, projectedProfit };
  };

  // Add new project
  const addProject = async (name, clientName) => {
    const newProject = {
      id: Date.now(),
      name,
      clientName,
      categories: [],
      payments: [],
      createdAt: new Date().toISOString()
    };

    await db.saveProject(newProject);
    setProjects([...projects, newProject]);
    setSelectedProject(newProject.id);
    setShowNewProject(false);
  };

  // Add category to project
  const addCategory = async (name, clientBudget, yourCost) => {
    const newCategory = {
      id: Date.now(),
      name,
      clientBudget: parseFloat(clientBudget),
      yourCost: parseFloat(yourCost),
      allocations: [],
      expenses: []
    };

    await db.saveCategory(selectedProject, newCategory);

    setProjects(projects.map(p => {
      if (p.id === selectedProject) {
        return {
          ...p,
          categories: [...p.categories, newCategory]
        };
      }
      return p;
    }));
    setShowNewCategory(false);
  };

  // Add payment from client
  const addPayment = async (checkNumber, totalAmount, allocations, date, notes) => {
    const paymentId = Date.now();
    const newPayment = {
      id: paymentId,
      checkNumber,
      totalAmount: parseFloat(totalAmount),
      allocations: allocations.filter(a => a.amount > 0),
      date,
      notes
    };

    await db.savePayment(selectedProject, newPayment, allocations);

    setProjects(projects.map(p => {
      if (p.id === selectedProject) {
        const newCategories = p.categories.map(cat => {
          const allocation = allocations.find(a => a.categoryId === cat.id);
          if (allocation && allocation.amount > 0) {
            return {
              ...cat,
              allocations: [...cat.allocations, {
                paymentId,
                amount: parseFloat(allocation.amount),
                date
              }]
            };
          }
          return cat;
        });

        return {
          ...p,
          categories: newCategories,
          payments: [...p.payments, newPayment]
        };
      }
      return p;
    }));
    setShowNewPayment(false);
  };

  // Add expense (payment to sub)
  const addExpense = async (categoryId, amount, date, description) => {
    const newExpense = {
      id: Date.now(),
      amount: parseFloat(amount),
      date,
      description
    };

    await db.saveExpense(categoryId, newExpense);

    setProjects(projects.map(p => {
      if (p.id === selectedProject) {
        return {
          ...p,
          categories: p.categories.map(cat => {
            if (cat.id === categoryId) {
              return {
                ...cat,
                expenses: [...cat.expenses, newExpense]
              };
            }
            return cat;
          })
        };
      }
      return p;
    }));
    setShowNewExpense(false);
  };

  // Delete handlers
  const deleteProject = async (projectId) => {
    if (confirm('Delete this project? This cannot be undone.')) {
      await db.deleteProject(projectId);
      setProjects(projects.filter(p => p.id !== projectId));
      if (selectedProject === projectId) {
        setSelectedProject(projects.length > 1 ? projects.find(p => p.id !== projectId)?.id : null);
      }
    }
  };

  const deleteCategory = async (categoryId) => {
    if (confirm('Delete this category? All allocations and expenses will be lost.')) {
      await db.deleteCategory(categoryId);
      setProjects(projects.map(p => {
        if (p.id === selectedProject) {
          return {
            ...p,
            categories: p.categories.filter(c => c.id !== categoryId)
          };
        }
        return p;
      }));
    }
  };

  const deletePayment = async (paymentId) => {
    if (confirm('Delete this payment? Allocations will be removed from categories.')) {
      await db.deletePayment(paymentId);
      setProjects(projects.map(p => {
        if (p.id === selectedProject) {
          return {
            ...p,
            payments: p.payments.filter(pay => pay.id !== paymentId),
            categories: p.categories.map(cat => ({
              ...cat,
              allocations: cat.allocations.filter(a => a.paymentId !== paymentId)
            }))
          };
        }
        return p;
      }));
    }
  };

  const deleteExpense = async (categoryId, expenseId) => {
    await db.deleteExpense(expenseId);
    setProjects(projects.map(p => {
      if (p.id === selectedProject) {
        return {
          ...p,
          categories: p.categories.map(cat => {
            if (cat.id === categoryId) {
              return {
                ...cat,
                expenses: cat.expenses.filter(e => e.id !== expenseId)
              };
            }
            return cat;
          })
        };
      }
      return p;
    }));
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Project totals
  const getProjectTotals = () => {
    if (!currentProject) return { totalBudget: 0, totalCost: 0, totalPaid: 0, totalSpent: 0 };

    return currentProject.categories.reduce((acc, cat) => {
      const totals = getCategoryTotals(cat);
      return {
        totalBudget: acc.totalBudget + cat.clientBudget,
        totalCost: acc.totalCost + cat.yourCost,
        totalPaid: acc.totalPaid + totals.clientPaid,
        totalSpent: acc.totalSpent + totals.youPaid
      };
    }, { totalBudget: 0, totalCost: 0, totalPaid: 0, totalSpent: 0 });
  };

  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p style={styles.loadingText}>Loading your data...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>⚒</span>
          <span style={styles.logoText}>ContractorCRM</span>
        </div>

        <div style={styles.projectList}>
          <div style={styles.sectionHeader}>
            <span>PROJECTS</span>
            <button style={styles.addBtn} onClick={() => setShowNewProject(true)}>+</button>
          </div>

          {projects.map(project => (
            <div
              key={project.id}
              style={{
                ...styles.projectItem,
                ...(selectedProject === project.id ? styles.projectItemActive : {})
              }}
              onClick={() => setSelectedProject(project.id)}
            >
              <div style={styles.projectName}>{project.name}</div>
              <div style={styles.projectClient}>{project.clientName}</div>
            </div>
          ))}

          {projects.length === 0 && (
            <div style={styles.emptyState}>
              No projects yet.<br/>Click + to add one.
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div style={styles.main}>
        {currentProject ? (
          <>
            {/* Header */}
            <div style={styles.header}>
              <div>
                <h1 style={styles.projectTitle}>{currentProject.name}</h1>
                <p style={styles.clientLabel}>Client: {currentProject.clientName}</p>
              </div>
              <button
                style={styles.deleteProjectBtn}
                onClick={() => deleteProject(currentProject.id)}
              >
                Delete Project
              </button>
            </div>

            {/* Summary Cards */}
            <div style={styles.summaryGrid}>
              {(() => {
                const totals = getProjectTotals();
                const projectedProfit = totals.totalBudget - totals.totalCost;
                const currentProfit = totals.totalPaid - totals.totalSpent;
                return (
                  <>
                    <div style={styles.summaryCard}>
                      <div style={styles.summaryLabel}>Client Budget</div>
                      <div style={styles.summaryValue}>{formatCurrency(totals.totalBudget)}</div>
                      <div style={styles.summarySubtext}>Total quoted to client</div>
                    </div>
                    <div style={styles.summaryCard}>
                      <div style={styles.summaryLabel}>Your Actual Cost</div>
                      <div style={styles.summaryValue}>{formatCurrency(totals.totalCost)}</div>
                      <div style={styles.summarySubtext}>What it really costs you</div>
                    </div>
                    <div style={styles.summaryCard}>
                      <div style={styles.summaryLabel}>Client Has Paid</div>
                      <div style={{...styles.summaryValue, color: '#10b981'}}>{formatCurrency(totals.totalPaid)}</div>
                      <div style={styles.summarySubtext}>{formatCurrency(totals.totalBudget - totals.totalPaid)} remaining</div>
                    </div>
                    <div style={styles.summaryCard}>
                      <div style={styles.summaryLabel}>You've Spent</div>
                      <div style={{...styles.summaryValue, color: '#f59e0b'}}>{formatCurrency(totals.totalSpent)}</div>
                      <div style={styles.summarySubtext}>{formatCurrency(totals.totalCost - totals.totalSpent)} left to pay</div>
                    </div>
                    <div style={{...styles.summaryCard, ...styles.profitCard}}>
                      <div style={styles.summaryLabel}>Projected Profit</div>
                      <div style={{...styles.summaryValue, color: projectedProfit >= 0 ? '#10b981' : '#ef4444'}}>
                        {formatCurrency(projectedProfit)}
                      </div>
                      <div style={styles.summarySubtext}>
                        Current: {formatCurrency(currentProfit)}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Tabs */}
            <div style={styles.tabs}>
              {['overview', 'payments', 'expenses'].map(tab => (
                <button
                  key={tab}
                  style={{
                    ...styles.tab,
                    ...(activeTab === tab ? styles.tabActive : {})
                  }}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div style={styles.tabContent}>
              {activeTab === 'overview' && (
                <div>
                  <div style={styles.sectionHeaderRow}>
                    <h2 style={styles.sectionTitle}>Cost Categories</h2>
                    <button style={styles.primaryBtn} onClick={() => setShowNewCategory(true)}>
                      + Add Category
                    </button>
                  </div>

                  {currentProject.categories.length === 0 ? (
                    <div style={styles.emptyCard}>
                      <p>No categories yet. Add categories like "Plumbing", "Framing", "Electrical" to start tracking.</p>
                    </div>
                  ) : (
                    <div style={styles.categoryGrid}>
                      {currentProject.categories.map(category => {
                        const totals = getCategoryTotals(category);
                        const clientProgress = (totals.clientPaid / category.clientBudget) * 100;
                        const yourProgress = (totals.youPaid / category.yourCost) * 100;
                        const isOverCollected = totals.clientPaid > category.clientBudget;
                        const isUnderwater = totals.youPaid > totals.clientPaid;

                        return (
                          <div key={category.id} style={styles.categoryCard}>
                            <div style={styles.categoryHeader}>
                              <h3 style={styles.categoryName}>{category.name}</h3>
                              <button
                                style={styles.deleteBtn}
                                onClick={() => deleteCategory(category.id)}
                              >
                                ×
                              </button>
                            </div>

                            {(isOverCollected || isUnderwater) && (
                              <div style={{
                                ...styles.warningBadge,
                                backgroundColor: isOverCollected ? '#fef2f2' : '#fffbeb',
                                color: isOverCollected ? '#dc2626' : '#d97706'
                              }}>
                                {isOverCollected ? '⚠ Over-collected from client!' : '⚠ Spent more than collected'}
                              </div>
                            )}

                            <div style={styles.categoryRow}>
                              <span style={styles.categoryLabel}>Client Budget:</span>
                              <span style={styles.categoryAmount}>{formatCurrency(category.clientBudget)}</span>
                            </div>
                            <div style={styles.categoryRow}>
                              <span style={styles.categoryLabel}>Your Real Cost:</span>
                              <span style={styles.categoryAmount}>{formatCurrency(category.yourCost)}</span>
                            </div>

                            <div style={styles.divider}></div>

                            <div style={styles.progressSection}>
                              <div style={styles.progressLabel}>
                                <span>Client Paid</span>
                                <span style={{color: '#10b981'}}>{formatCurrency(totals.clientPaid)}</span>
                              </div>
                              <div style={styles.progressBar}>
                                <div style={{
                                  ...styles.progressFill,
                                  width: `${Math.min(clientProgress, 100)}%`,
                                  backgroundColor: isOverCollected ? '#ef4444' : '#10b981'
                                }}></div>
                              </div>
                              <div style={styles.progressSubtext}>
                                {formatCurrency(totals.remaining)} remaining to collect
                              </div>
                            </div>

                            <div style={styles.progressSection}>
                              <div style={styles.progressLabel}>
                                <span>You've Paid Sub</span>
                                <span style={{color: '#f59e0b'}}>{formatCurrency(totals.youPaid)}</span>
                              </div>
                              <div style={styles.progressBar}>
                                <div style={{
                                  ...styles.progressFill,
                                  width: `${Math.min(yourProgress, 100)}%`,
                                  backgroundColor: '#f59e0b'
                                }}></div>
                              </div>
                              <div style={styles.progressSubtext}>
                                {formatCurrency(totals.yourRemaining)} left to pay sub
                              </div>
                            </div>

                            <div style={styles.divider}></div>

                            <div style={styles.categoryRow}>
                              <span style={styles.categoryLabel}>Projected Profit:</span>
                              <span style={{
                                ...styles.categoryAmount,
                                color: totals.projectedProfit >= 0 ? '#10b981' : '#ef4444'
                              }}>
                                {formatCurrency(totals.projectedProfit)}
                              </span>
                            </div>
                            <div style={styles.categoryRow}>
                              <span style={styles.categoryLabel}>Current Margin:</span>
                              <span style={{
                                ...styles.categoryAmount,
                                color: totals.profit >= 0 ? '#10b981' : '#ef4444'
                              }}>
                                {formatCurrency(totals.profit)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'payments' && (
                <div>
                  <div style={styles.sectionHeaderRow}>
                    <h2 style={styles.sectionTitle}>Client Payments</h2>
                    <button
                      style={styles.primaryBtn}
                      onClick={() => setShowNewPayment(true)}
                      disabled={currentProject.categories.length === 0}
                    >
                      + Record Payment
                    </button>
                  </div>

                  {currentProject.payments.length === 0 ? (
                    <div style={styles.emptyCard}>
                      <p>No payments recorded yet. When your client gives you a check, record it here and allocate it to your cost categories.</p>
                    </div>
                  ) : (
                    <div style={styles.paymentList}>
                      {currentProject.payments.sort((a, b) => new Date(b.date) - new Date(a.date)).map(payment => (
                        <div key={payment.id} style={styles.paymentCard}>
                          <div style={styles.paymentHeader}>
                            <div>
                              <div style={styles.paymentCheck}>Check #{payment.checkNumber}</div>
                              <div style={styles.paymentDate}>{formatDate(payment.date)}</div>
                            </div>
                            <div style={styles.paymentAmountSection}>
                              <div style={styles.paymentTotal}>{formatCurrency(payment.totalAmount)}</div>
                              <button
                                style={styles.deleteBtn}
                                onClick={() => deletePayment(payment.id)}
                              >
                                ×
                              </button>
                            </div>
                          </div>

                          {payment.notes && (
                            <div style={styles.paymentNotes}>{payment.notes}</div>
                          )}

                          <div style={styles.allocationList}>
                            <div style={styles.allocationHeader}>Allocated to:</div>
                            {payment.allocations.map((alloc, idx) => {
                              const cat = currentProject.categories.find(c => c.id === alloc.categoryId);
                              return (
                                <div key={idx} style={styles.allocationItem}>
                                  <span>{cat?.name || 'Unknown'}</span>
                                  <span>{formatCurrency(alloc.amount)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'expenses' && (
                <div>
                  <div style={styles.sectionHeaderRow}>
                    <h2 style={styles.sectionTitle}>Your Expenses (Payments to Subs)</h2>
                    <button
                      style={styles.primaryBtn}
                      onClick={() => setShowNewExpense(true)}
                      disabled={currentProject.categories.length === 0}
                    >
                      + Record Expense
                    </button>
                  </div>

                  {currentProject.categories.every(c => c.expenses.length === 0) ? (
                    <div style={styles.emptyCard}>
                      <p>No expenses recorded yet. When you pay a subcontractor, record it here to track your actual costs.</p>
                    </div>
                  ) : (
                    <div style={styles.expenseList}>
                      {currentProject.categories.map(category => {
                        if (category.expenses.length === 0) return null;
                        return (
                          <div key={category.id} style={styles.expenseGroup}>
                            <h3 style={styles.expenseGroupTitle}>{category.name}</h3>
                            {category.expenses.sort((a, b) => new Date(b.date) - new Date(a.date)).map(expense => (
                              <div key={expense.id} style={styles.expenseItem}>
                                <div>
                                  <div style={styles.expenseDesc}>{expense.description}</div>
                                  <div style={styles.expenseDate}>{formatDate(expense.date)}</div>
                                </div>
                                <div style={styles.expenseAmountSection}>
                                  <div style={styles.expenseAmount}>{formatCurrency(expense.amount)}</div>
                                  <button
                                    style={styles.deleteBtn}
                                    onClick={() => deleteExpense(category.id, expense.id)}
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={styles.noProjectSelected}>
            <div style={styles.noProjectIcon}>📋</div>
            <h2>Select or create a project</h2>
            <p>Choose a project from the sidebar or create a new one to get started.</p>
            <button style={styles.primaryBtn} onClick={() => setShowNewProject(true)}>
              + New Project
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewProject && (
        <Modal onClose={() => setShowNewProject(false)} title="New Project">
          <NewProjectForm onSubmit={addProject} onCancel={() => setShowNewProject(false)} />
        </Modal>
      )}

      {showNewCategory && (
        <Modal onClose={() => setShowNewCategory(false)} title="Add Cost Category">
          <NewCategoryForm onSubmit={addCategory} onCancel={() => setShowNewCategory(false)} />
        </Modal>
      )}

      {showNewPayment && currentProject && (
        <Modal onClose={() => setShowNewPayment(false)} title="Record Client Payment">
          <NewPaymentForm
            categories={currentProject.categories}
            onSubmit={addPayment}
            onCancel={() => setShowNewPayment(false)}
          />
        </Modal>
      )}

      {showNewExpense && currentProject && (
        <Modal onClose={() => setShowNewExpense(false)} title="Record Expense">
          <NewExpenseForm
            categories={currentProject.categories}
            onSubmit={addExpense}
            onCancel={() => setShowNewExpense(false)}
          />
        </Modal>
      )}
    </div>
  );
};

// Modal Component
const Modal = ({ children, onClose, title }) => (
  <div style={styles.modalOverlay} onClick={onClose}>
    <div style={styles.modal} onClick={e => e.stopPropagation()}>
      <div style={styles.modalHeader}>
        <h2 style={styles.modalTitle}>{title}</h2>
        <button style={styles.modalClose} onClick={onClose}>×</button>
      </div>
      {children}
    </div>
  </div>
);

// Form Components
const NewProjectForm = ({ onSubmit, onCancel }) => {
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(name, clientName); }}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Project Name</label>
        <input
          style={styles.input}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., 123 Main St Renovation"
          required
        />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Client Name</label>
        <input
          style={styles.input}
          value={clientName}
          onChange={e => setClientName(e.target.value)}
          placeholder="e.g., Jane Smith"
          required
        />
      </div>
      <div style={styles.formActions}>
        <button type="button" style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button type="submit" style={styles.submitBtn}>Create Project</button>
      </div>
    </form>
  );
};

const NewCategoryForm = ({ onSubmit, onCancel }) => {
  const [name, setName] = useState('');
  const [clientBudget, setClientBudget] = useState('');
  const [yourCost, setYourCost] = useState('');

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(name, clientBudget, yourCost); }}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Category Name</label>
        <input
          style={styles.input}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., Plumbing, Framing, Electrical"
          required
        />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Client Budget (what they'll pay)</label>
        <input
          style={styles.input}
          type="number"
          value={clientBudget}
          onChange={e => setClientBudget(e.target.value)}
          placeholder="30000"
          required
        />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Your Actual Cost (what you'll pay sub)</label>
        <input
          style={styles.input}
          type="number"
          value={yourCost}
          onChange={e => setYourCost(e.target.value)}
          placeholder="22000"
          required
        />
      </div>
      <div style={styles.formActions}>
        <button type="button" style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button type="submit" style={styles.submitBtn}>Add Category</button>
      </div>
    </form>
  );
};

const NewPaymentForm = ({ categories, onSubmit, onCancel }) => {
  const [checkNumber, setCheckNumber] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState(
    categories.map(c => ({ categoryId: c.id, amount: '' }))
  );

  const allocatedTotal = allocations.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
  const remaining = (parseFloat(totalAmount) || 0) - allocatedTotal;

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(checkNumber, totalAmount, allocations.map(a => ({...a, amount: parseFloat(a.amount) || 0})), date, notes); }}>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Check #</label>
          <input
            style={styles.input}
            value={checkNumber}
            onChange={e => setCheckNumber(e.target.value)}
            placeholder="1234"
            required
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Date</label>
          <input
            style={styles.input}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
          />
        </div>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Total Amount</label>
        <input
          style={styles.input}
          type="number"
          value={totalAmount}
          onChange={e => setTotalAmount(e.target.value)}
          placeholder="20000"
          required
        />
      </div>

      <div style={styles.allocationSection}>
        <label style={styles.label}>Allocate to Categories</label>
        {categories.map((cat, idx) => (
          <div key={cat.id} style={styles.allocationRow}>
            <span style={styles.allocationCatName}>{cat.name}</span>
            <input
              style={{...styles.input, width: '120px'}}
              type="number"
              value={allocations[idx].amount}
              onChange={e => {
                const newAllocs = [...allocations];
                newAllocs[idx].amount = e.target.value;
                setAllocations(newAllocs);
              }}
              placeholder="0"
            />
          </div>
        ))}
        <div style={{
          ...styles.allocationSummary,
          color: remaining < 0 ? '#ef4444' : remaining > 0 ? '#f59e0b' : '#10b981'
        }}>
          {remaining === 0 ? '✓ Fully allocated' :
           remaining > 0 ? `$${remaining.toLocaleString()} unallocated` :
           `$${Math.abs(remaining).toLocaleString()} over-allocated`}
        </div>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Notes (optional)</label>
        <input
          style={styles.input}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any notes about this payment"
        />
      </div>

      <div style={styles.formActions}>
        <button type="button" style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button type="submit" style={styles.submitBtn} disabled={remaining !== 0}>Record Payment</button>
      </div>
    </form>
  );
};

const NewExpenseForm = ({ categories, onSubmit, onCancel }) => {
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(parseInt(categoryId), amount, date, description); }}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Category</label>
        <select
          style={styles.input}
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
          required
        >
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Amount</label>
          <input
            style={styles.input}
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="5000"
            required
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Date</label>
          <input
            style={styles.input}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
          />
        </div>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Description</label>
        <input
          style={styles.input}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g., Rough plumbing - first draw"
          required
        />
      </div>
      <div style={styles.formActions}>
        <button type="button" style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button type="submit" style={styles.submitBtn}>Record Expense</button>
      </div>
    </form>
  );
};

// Styles
const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
  },
  loadingSpinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #334155',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    marginTop: '16px',
    color: '#94a3b8',
  },
  sidebar: {
    width: '280px',
    backgroundColor: '#1e293b',
    borderRight: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column',
  },
  logo: {
    padding: '24px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    borderBottom: '1px solid #334155',
  },
  logoIcon: {
    fontSize: '24px',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: '-0.5px',
  },
  projectList: {
    padding: '16px',
    flex: 1,
    overflowY: 'auto',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '1px',
    color: '#64748b',
  },
  addBtn: {
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#334155',
    color: '#94a3b8',
    fontSize: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectItem: {
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '8px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    border: '1px solid transparent',
  },
  projectItemActive: {
    backgroundColor: '#334155',
    border: '1px solid #475569',
  },
  projectName: {
    fontWeight: '600',
    fontSize: '14px',
    color: '#f1f5f9',
    marginBottom: '4px',
  },
  projectClient: {
    fontSize: '12px',
    color: '#64748b',
  },
  emptyState: {
    padding: '24px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.6,
  },
  main: {
    flex: 1,
    padding: '32px',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
  },
  projectTitle: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: '4px',
    letterSpacing: '-0.5px',
  },
  clientLabel: {
    fontSize: '14px',
    color: '#64748b',
  },
  deleteProjectBtn: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid #7f1d1d',
    backgroundColor: 'transparent',
    color: '#fca5a5',
    fontSize: '13px',
    cursor: 'pointer',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '16px',
    marginBottom: '32px',
  },
  summaryCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #334155',
  },
  profitCard: {
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    border: '1px solid #475569',
  },
  summaryLabel: {
    fontSize: '12px',
    color: '#64748b',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  summaryValue: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: '4px',
  },
  summarySubtext: {
    fontSize: '12px',
    color: '#64748b',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '24px',
    borderBottom: '1px solid #334155',
    paddingBottom: '4px',
  },
  tab: {
    padding: '12px 20px',
    borderRadius: '8px 8px 0 0',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#64748b',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  tabActive: {
    backgroundColor: '#334155',
    color: '#f1f5f9',
  },
  tabContent: {
    minHeight: '400px',
  },
  sectionHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#f1f5f9',
  },
  primaryBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  emptyCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '40px',
    textAlign: 'center',
    color: '#64748b',
    border: '1px dashed #334155',
  },
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px',
  },
  categoryCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #334155',
  },
  categoryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  categoryName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#f1f5f9',
  },
  deleteBtn: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#64748b',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningBadge: {
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    marginBottom: '16px',
  },
  categoryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  categoryLabel: {
    fontSize: '13px',
    color: '#94a3b8',
  },
  categoryAmount: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#f1f5f9',
  },
  divider: {
    height: '1px',
    backgroundColor: '#334155',
    margin: '16px 0',
  },
  progressSection: {
    marginBottom: '16px',
  },
  progressLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    marginBottom: '6px',
    color: '#94a3b8',
  },
  progressBar: {
    height: '6px',
    backgroundColor: '#334155',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  progressSubtext: {
    fontSize: '11px',
    color: '#64748b',
    marginTop: '4px',
  },
  paymentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  paymentCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #334155',
  },
  paymentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  paymentCheck: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#f1f5f9',
  },
  paymentDate: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '4px',
  },
  paymentAmountSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  paymentTotal: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#10b981',
  },
  paymentNotes: {
    fontSize: '13px',
    color: '#94a3b8',
    marginBottom: '12px',
    fontStyle: 'italic',
  },
  allocationList: {
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    padding: '12px',
  },
  allocationHeader: {
    fontSize: '11px',
    color: '#64748b',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  allocationItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    padding: '6px 0',
    borderBottom: '1px solid #1e293b',
    color: '#e2e8f0',
  },
  expenseList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  expenseGroup: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #334155',
  },
  expenseGroupTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #334155',
  },
  expenseItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #334155',
  },
  expenseDesc: {
    fontSize: '14px',
    color: '#e2e8f0',
  },
  expenseDate: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '4px',
  },
  expenseAmountSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  expenseAmount: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#f59e0b',
  },
  noProjectSelected: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    textAlign: 'center',
    color: '#64748b',
  },
  noProjectIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#1e293b',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '480px',
    border: '1px solid #334155',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #334155',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#f1f5f9',
  },
  modalClose: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#334155',
    color: '#94a3b8',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formGroup: {
    padding: '0 24px',
    marginBottom: '16px',
  },
  formRow: {
    display: 'flex',
    gap: '16px',
    padding: '0 24px',
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    color: '#94a3b8',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid #334155',
    backgroundColor: '#0f172a',
    color: '#f1f5f9',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  formActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    padding: '20px 24px',
    borderTop: '1px solid #334155',
    marginTop: '8px',
  },
  cancelBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: '1px solid #334155',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    fontSize: '14px',
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  allocationSection: {
    padding: '0 24px',
    marginBottom: '16px',
  },
  allocationRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
  },
  allocationCatName: {
    fontSize: '14px',
    color: '#e2e8f0',
  },
  allocationSummary: {
    marginTop: '12px',
    padding: '8px 12px',
    backgroundColor: '#0f172a',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    textAlign: 'center',
  },
};

export default ContractorCRM;
