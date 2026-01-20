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

  // Warning level calculation
  const getWarningLevel = (buffer, remainingToPay) => {
    if (remainingToPay <= 0) return 'green'; // All paid, no risk
    const threshold = remainingToPay * 0.20;
    if (buffer < 0) return 'red';      // SHORTFALL
    if (buffer <= threshold) return 'yellow';  // Low buffer
    return 'green';  // Healthy buffer
  };

  // Calculate totals for a category (supports both modes)
  const getCategoryTotals = (category) => {
    const mode = category.mode || 'all-inclusive';

    if (mode === 'separate') {
      // Separate mode: Labor + Materials
      const laborCollected = category.allocations?.reduce((sum, a) => sum + (a.laborAmount || 0), 0) || 0;
      const materialsCollected = category.allocations?.reduce((sum, a) => sum + (a.materialsAmount || 0), 0) || 0;
      const laborPaid = category.expenses?.filter(e => e.type === 'labor').reduce((sum, e) => sum + e.amount, 0) || 0;
      const materialsPaid = category.expenses?.filter(e => e.type === 'materials').reduce((sum, e) => sum + e.amount, 0) || 0;

      const laborBudget = category.laborBudget || 0;
      const laborCost = category.laborCost || 0;
      const materialsBudget = category.materialsBudget || 0;

      const laborRemainingToCollect = laborBudget - laborCollected;
      const laborRemainingToPay = laborCost - laborPaid;
      const laborBuffer = laborRemainingToCollect - laborRemainingToPay;

      const materialsRemainingToCollect = materialsBudget - materialsCollected;
      const materialsRemainingToPay = materialsBudget - materialsPaid; // Materials: budget = cost (pass-through)

      return {
        mode: 'separate',
        // Labor metrics
        laborCollected,
        laborPaid,
        laborRemainingToCollect,
        laborRemainingToPay,
        laborBuffer,
        laborWarningLevel: getWarningLevel(laborBuffer, laborRemainingToPay),
        laborProfit: laborBudget - laborCost, // Projected profit from labor
        // Materials metrics (pass-through, no profit margin)
        materialsCollected,
        materialsPaid,
        materialsRemainingToCollect,
        materialsRemainingToPay,
        // Combined totals for project-level calculations
        totalCollected: laborCollected + materialsCollected,
        totalPaid: laborPaid + materialsPaid,
        totalBudget: laborBudget + materialsBudget,
        totalCost: laborCost + materialsBudget, // Materials are pass-through
        projectedProfit: laborBudget - laborCost, // Only labor has margin
        currentProfit: (laborCollected + materialsCollected) - (laborPaid + materialsPaid)
      };
    } else {
      // All-inclusive mode (default, also handles migrated data)
      const budget = category.totalBudget ?? category.clientBudget ?? 0;
      const cost = category.totalCost ?? category.yourCost ?? 0;

      const collected = category.allocations?.reduce((sum, a) => sum + (a.amount || 0), 0) || 0;
      const paid = category.expenses?.reduce((sum, e) => sum + e.amount, 0) || 0;

      const remainingToCollect = budget - collected;
      const remainingToPay = cost - paid;
      const buffer = remainingToCollect - remainingToPay;

      return {
        mode: 'all-inclusive',
        budget,
        cost,
        collected,
        paid,
        remainingToCollect,
        remainingToPay,
        buffer,
        warningLevel: getWarningLevel(buffer, remainingToPay),
        projectedProfit: budget - cost,
        currentMargin: collected - paid,
        // For backward compatibility with old code
        clientPaid: collected,
        youPaid: paid,
        remaining: remainingToCollect,
        yourRemaining: remainingToPay,
        profit: collected - paid,
        // For project totals
        totalCollected: collected,
        totalPaid: paid,
        totalBudget: budget,
        totalCost: cost
      };
    }
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

  // Add category to project (supports both modes)
  const addCategory = async (categoryData) => {
    const newCategory = {
      id: Date.now(),
      name: categoryData.name,
      mode: categoryData.mode,
      allocations: [],
      expenses: []
    };

    if (categoryData.mode === 'separate') {
      newCategory.laborBudget = parseFloat(categoryData.laborBudget) || 0;
      newCategory.laborCost = parseFloat(categoryData.laborCost) || 0;
      newCategory.materialsBudget = parseFloat(categoryData.materialsBudget) || 0;
      newCategory.totalBudget = null;
      newCategory.totalCost = null;
    } else {
      newCategory.totalBudget = parseFloat(categoryData.totalBudget) || 0;
      newCategory.totalCost = parseFloat(categoryData.totalCost) || 0;
      newCategory.laborBudget = null;
      newCategory.laborCost = null;
      newCategory.materialsBudget = null;
    }

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

  // Add payment from client (supports both allocation types)
  const addPayment = async (paymentData) => {
    const paymentId = Date.now();
    const newPayment = {
      id: paymentId,
      paymentMethod: paymentData.paymentMethod,
      reference: paymentData.reference,
      totalAmount: parseFloat(paymentData.totalAmount),
      allocations: paymentData.allocations.filter(a =>
        (a.amount > 0) || (a.laborAmount > 0) || (a.materialsAmount > 0)
      ),
      date: paymentData.date,
      notes: paymentData.notes
    };

    await db.savePayment(selectedProject, newPayment, paymentData.allocations);

    setProjects(projects.map(p => {
      if (p.id === selectedProject) {
        const newCategories = p.categories.map(cat => {
          const allocation = paymentData.allocations.find(a => a.categoryId === cat.id);
          if (!allocation) return cat;

          const hasAllocation = (allocation.amount > 0) ||
                               (allocation.laborAmount > 0) ||
                               (allocation.materialsAmount > 0);

          if (hasAllocation) {
            return {
              ...cat,
              allocations: [...cat.allocations, {
                paymentId,
                amount: parseFloat(allocation.amount) || null,
                laborAmount: parseFloat(allocation.laborAmount) || null,
                materialsAmount: parseFloat(allocation.materialsAmount) || null,
                date: paymentData.date
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

  // Add expense (payment to sub) - supports typed expenses for separate mode
  const addExpense = async (expenseData) => {
    const newExpense = {
      id: Date.now(),
      amount: parseFloat(expenseData.amount),
      date: expenseData.date,
      description: expenseData.description,
      type: expenseData.type || null,
      paymentMethod: expenseData.paymentMethod || null,
      reference: expenseData.reference || null
    };

    await db.saveExpense(expenseData.categoryId, newExpense);

    setProjects(projects.map(p => {
      if (p.id === selectedProject) {
        return {
          ...p,
          categories: p.categories.map(cat => {
            if (cat.id === expenseData.categoryId) {
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

  // Project totals (handles both category modes)
  const getProjectTotals = () => {
    if (!currentProject) return {
      totalBudget: 0, totalCost: 0, totalPaid: 0, totalSpent: 0,
      categoryHealth: { green: 0, yellow: 0, red: 0 }
    };

    let totalBudget = 0;
    let totalCost = 0;
    let totalPaid = 0;
    let totalSpent = 0;
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;

    currentProject.categories.forEach(cat => {
      const totals = getCategoryTotals(cat);

      totalBudget += totals.totalBudget || 0;
      totalCost += totals.totalCost || 0;
      totalPaid += totals.totalCollected || 0;
      totalSpent += totals.totalPaid || 0;

      // Count warning levels
      const warningLevel = totals.mode === 'separate'
        ? totals.laborWarningLevel
        : totals.warningLevel;

      if (warningLevel === 'red') redCount++;
      else if (warningLevel === 'yellow') yellowCount++;
      else greenCount++;
    });

    return {
      totalBudget,
      totalCost,
      totalPaid,
      totalSpent,
      categoryHealth: { green: greenCount, yellow: yellowCount, red: redCount }
    };
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
                const health = totals.categoryHealth;
                const totalCategories = health.green + health.yellow + health.red;
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
                    <div style={{
                      ...styles.summaryCard,
                      borderColor: health.red > 0 ? '#b91c1c' : health.yellow > 0 ? '#a16207' : '#166534'
                    }}>
                      <div style={styles.summaryLabel}>Category Health</div>
                      <div style={styles.healthIndicators}>
                        {health.red > 0 && (
                          <span style={styles.healthBadgeRed}>
                            {health.red} Alert{health.red > 1 ? 's' : ''}
                          </span>
                        )}
                        {health.yellow > 0 && (
                          <span style={styles.healthBadgeYellow}>
                            {health.yellow} Caution
                          </span>
                        )}
                        {health.green > 0 && (
                          <span style={styles.healthBadgeGreen}>
                            {health.green} Healthy
                          </span>
                        )}
                      </div>
                      <div style={styles.summarySubtext}>
                        {totalCategories} categor{totalCategories === 1 ? 'y' : 'ies'} total
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
                        const mode = category.mode || 'all-inclusive';

                        // Warning indicator colors
                        const warningColors = {
                          green: { bg: '#052e16', border: '#166534', dot: '#22c55e' },
                          yellow: { bg: '#422006', border: '#a16207', dot: '#eab308' },
                          red: { bg: '#450a0a', border: '#b91c1c', dot: '#ef4444' }
                        };

                        if (mode === 'separate') {
                          // SEPARATE MODE CARD - Labor & Materials tracked separately
                          const laborWarning = warningColors[totals.laborWarningLevel];
                          const laborCollectedPct = category.laborBudget > 0
                            ? (totals.laborCollected / category.laborBudget) * 100 : 0;
                          const laborPaidPct = category.laborCost > 0
                            ? (totals.laborPaid / category.laborCost) * 100 : 0;
                          const materialsCollectedPct = category.materialsBudget > 0
                            ? (totals.materialsCollected / category.materialsBudget) * 100 : 0;
                          const materialsPaidPct = totals.materialsCollected > 0
                            ? (totals.materialsPaid / totals.materialsCollected) * 100 : 0;

                          return (
                            <div key={category.id} style={{
                              ...styles.categoryCard,
                              borderColor: laborWarning.border
                            }}>
                              <div style={styles.categoryHeader}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                    ...styles.warningDot,
                                    backgroundColor: laborWarning.dot
                                  }}></span>
                                  <h3 style={styles.categoryName}>{category.name}</h3>
                                  <span style={styles.modeBadgeSmall}>SEP</span>
                                </div>
                                <button
                                  style={styles.deleteBtn}
                                  onClick={() => deleteCategory(category.id)}
                                >
                                  ×
                                </button>
                              </div>

                              {totals.laborWarningLevel === 'red' && (
                                <div style={{
                                  ...styles.warningBadge,
                                  backgroundColor: '#fef2f2',
                                  color: '#dc2626'
                                }}>
                                  ⚠ Can't cover sub! Need {formatCurrency(Math.abs(totals.laborBuffer))} more
                                </div>
                              )}
                              {totals.laborWarningLevel === 'yellow' && (
                                <div style={{
                                  ...styles.warningBadge,
                                  backgroundColor: '#fefce8',
                                  color: '#a16207'
                                }}>
                                  ⚠ Low buffer - only {formatCurrency(totals.laborBuffer)} cushion
                                </div>
                              )}

                              {/* LABOR SECTION */}
                              <div style={styles.subSection}>
                                <div style={styles.subSectionTitle}>Labor</div>
                                <div style={styles.categoryRow}>
                                  <span style={styles.categoryLabel}>Budget from Client:</span>
                                  <span style={styles.categoryAmount}>{formatCurrency(category.laborBudget)}</span>
                                </div>
                                <div style={styles.categoryRow}>
                                  <span style={styles.categoryLabel}>Your Cost to Sub:</span>
                                  <span style={styles.categoryAmount}>{formatCurrency(category.laborCost)}</span>
                                </div>
                                <div style={styles.progressSection}>
                                  <div style={styles.progressLabel}>
                                    <span>Collected</span>
                                    <span style={{color: '#10b981'}}>{formatCurrency(totals.laborCollected)}</span>
                                  </div>
                                  <div style={styles.progressBar}>
                                    <div style={{
                                      ...styles.progressFill,
                                      width: `${Math.min(laborCollectedPct, 100)}%`,
                                      backgroundColor: '#10b981'
                                    }}></div>
                                  </div>
                                </div>
                                <div style={styles.progressSection}>
                                  <div style={styles.progressLabel}>
                                    <span>Paid to Sub</span>
                                    <span style={{color: '#f59e0b'}}>{formatCurrency(totals.laborPaid)}</span>
                                  </div>
                                  <div style={styles.progressBar}>
                                    <div style={{
                                      ...styles.progressFill,
                                      width: `${Math.min(laborPaidPct, 100)}%`,
                                      backgroundColor: '#f59e0b'
                                    }}></div>
                                  </div>
                                </div>
                                <div style={styles.categoryRow}>
                                  <span style={styles.categoryLabel}>Projected Profit:</span>
                                  <span style={{
                                    ...styles.categoryAmount,
                                    color: totals.laborProfit >= 0 ? '#10b981' : '#ef4444'
                                  }}>
                                    {formatCurrency(totals.laborProfit)}
                                  </span>
                                </div>
                              </div>

                              <div style={styles.divider}></div>

                              {/* MATERIALS SECTION */}
                              <div style={styles.subSection}>
                                <div style={styles.subSectionTitle}>Materials (Pass-through)</div>
                                <div style={styles.categoryRow}>
                                  <span style={styles.categoryLabel}>Budget:</span>
                                  <span style={styles.categoryAmount}>{formatCurrency(category.materialsBudget)}</span>
                                </div>
                                <div style={styles.progressSection}>
                                  <div style={styles.progressLabel}>
                                    <span>Collected</span>
                                    <span style={{color: '#10b981'}}>{formatCurrency(totals.materialsCollected)}</span>
                                  </div>
                                  <div style={styles.progressBar}>
                                    <div style={{
                                      ...styles.progressFill,
                                      width: `${Math.min(materialsCollectedPct, 100)}%`,
                                      backgroundColor: '#10b981'
                                    }}></div>
                                  </div>
                                </div>
                                <div style={styles.progressSection}>
                                  <div style={styles.progressLabel}>
                                    <span>Spent</span>
                                    <span style={{color: '#f59e0b'}}>{formatCurrency(totals.materialsPaid)}</span>
                                  </div>
                                  <div style={styles.progressBar}>
                                    <div style={{
                                      ...styles.progressFill,
                                      width: `${Math.min(materialsPaidPct, 100)}%`,
                                      backgroundColor: '#f59e0b'
                                    }}></div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        } else {
                          // ALL-INCLUSIVE MODE CARD - Original style with warning indicators
                          const warning = warningColors[totals.warningLevel];
                          const collectedPct = totals.budget > 0
                            ? (totals.collected / totals.budget) * 100 : 0;
                          const paidPct = totals.cost > 0
                            ? (totals.paid / totals.cost) * 100 : 0;

                          return (
                            <div key={category.id} style={{
                              ...styles.categoryCard,
                              borderColor: warning.border
                            }}>
                              <div style={styles.categoryHeader}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                    ...styles.warningDot,
                                    backgroundColor: warning.dot
                                  }}></span>
                                  <h3 style={styles.categoryName}>{category.name}</h3>
                                  <span style={styles.modeBadgeSmall}>ALL</span>
                                </div>
                                <button
                                  style={styles.deleteBtn}
                                  onClick={() => deleteCategory(category.id)}
                                >
                                  ×
                                </button>
                              </div>

                              {totals.warningLevel === 'red' && (
                                <div style={{
                                  ...styles.warningBadge,
                                  backgroundColor: '#fef2f2',
                                  color: '#dc2626'
                                }}>
                                  ⚠ Can't cover sub! Need {formatCurrency(Math.abs(totals.buffer))} more
                                </div>
                              )}
                              {totals.warningLevel === 'yellow' && (
                                <div style={{
                                  ...styles.warningBadge,
                                  backgroundColor: '#fefce8',
                                  color: '#a16207'
                                }}>
                                  ⚠ Low buffer - only {formatCurrency(totals.buffer)} cushion
                                </div>
                              )}

                              <div style={styles.categoryRow}>
                                <span style={styles.categoryLabel}>Client Budget:</span>
                                <span style={styles.categoryAmount}>{formatCurrency(totals.budget)}</span>
                              </div>
                              <div style={styles.categoryRow}>
                                <span style={styles.categoryLabel}>Your Cost:</span>
                                <span style={styles.categoryAmount}>{formatCurrency(totals.cost)}</span>
                              </div>

                              <div style={styles.divider}></div>

                              <div style={styles.progressSection}>
                                <div style={styles.progressLabel}>
                                  <span>Collected from Client</span>
                                  <span style={{color: '#10b981'}}>{formatCurrency(totals.collected)}</span>
                                </div>
                                <div style={styles.progressBar}>
                                  <div style={{
                                    ...styles.progressFill,
                                    width: `${Math.min(collectedPct, 100)}%`,
                                    backgroundColor: '#10b981'
                                  }}></div>
                                </div>
                                <div style={styles.progressSubtext}>
                                  {formatCurrency(totals.remainingToCollect)} remaining to collect
                                </div>
                              </div>

                              <div style={styles.progressSection}>
                                <div style={styles.progressLabel}>
                                  <span>Paid to Sub</span>
                                  <span style={{color: '#f59e0b'}}>{formatCurrency(totals.paid)}</span>
                                </div>
                                <div style={styles.progressBar}>
                                  <div style={{
                                    ...styles.progressFill,
                                    width: `${Math.min(paidPct, 100)}%`,
                                    backgroundColor: '#f59e0b'
                                  }}></div>
                                </div>
                                <div style={styles.progressSubtext}>
                                  {formatCurrency(totals.remainingToPay)} left to pay sub
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
                                  color: totals.currentMargin >= 0 ? '#10b981' : '#ef4444'
                                }}>
                                  {formatCurrency(totals.currentMargin)}
                                </span>
                              </div>
                            </div>
                          );
                        }
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
                      {currentProject.payments.sort((a, b) => new Date(b.date) - new Date(a.date)).map(payment => {
                        const methodLabel = {
                          check: 'Check',
                          zelle: 'Zelle',
                          cash: 'Cash',
                          other: 'Other'
                        }[payment.paymentMethod || 'check'];
                        const ref = payment.reference || payment.checkNumber || '';

                        return (
                          <div key={payment.id} style={styles.paymentCard}>
                            <div style={styles.paymentHeader}>
                              <div>
                                <div style={styles.paymentCheck}>
                                  {methodLabel}{ref ? ` #${ref}` : ''}
                                </div>
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
                              {payment.allocations.filter(a =>
                                (a.amount > 0) || (a.laborAmount > 0) || (a.materialsAmount > 0)
                              ).map((alloc, idx) => {
                                const cat = currentProject.categories.find(c => c.id === alloc.categoryId);
                                const catMode = cat?.mode || 'all-inclusive';

                                if (catMode === 'separate') {
                                  // Show labor/materials breakdown for separate mode
                                  const parts = [];
                                  if (alloc.laborAmount > 0) parts.push(`Labor: ${formatCurrency(alloc.laborAmount)}`);
                                  if (alloc.materialsAmount > 0) parts.push(`Materials: ${formatCurrency(alloc.materialsAmount)}`);
                                  return (
                                    <div key={idx} style={styles.allocationItem}>
                                      <span>{cat?.name || 'Unknown'}</span>
                                      <span style={{ fontSize: '12px' }}>{parts.join(' / ')}</span>
                                    </div>
                                  );
                                }

                                return (
                                  <div key={idx} style={styles.allocationItem}>
                                    <span>{cat?.name || 'Unknown'}</span>
                                    <span>{formatCurrency(alloc.amount)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
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
                        const catMode = category.mode || 'all-inclusive';
                        return (
                          <div key={category.id} style={styles.expenseGroup}>
                            <h3 style={styles.expenseGroupTitle}>
                              {category.name}
                              <span style={styles.modeBadge}>
                                {catMode === 'separate' ? 'SEP' : 'ALL'}
                              </span>
                            </h3>
                            {category.expenses.sort((a, b) => new Date(b.date) - new Date(a.date)).map(expense => (
                              <div key={expense.id} style={styles.expenseItem}>
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={styles.expenseDesc}>{expense.description}</span>
                                    {catMode === 'separate' && expense.type && (
                                      <span style={{
                                        ...styles.typeBadge,
                                        ...(expense.type === 'labor' ? styles.typeBadgeLabor : styles.typeBadgeMaterials)
                                      }}>
                                        {expense.type}
                                      </span>
                                    )}
                                  </div>
                                  <div style={styles.expenseDate}>
                                    {formatDate(expense.date)}
                                    {expense.paymentMethod && (
                                      <span style={{ marginLeft: '8px', color: '#64748b' }}>
                                        via {expense.paymentMethod}{expense.reference ? ` #${expense.reference}` : ''}
                                      </span>
                                    )}
                                  </div>
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
  const [mode, setMode] = useState('all-inclusive');
  // All-inclusive fields
  const [totalBudget, setTotalBudget] = useState('');
  const [totalCost, setTotalCost] = useState('');
  // Separate mode fields
  const [laborBudget, setLaborBudget] = useState('');
  const [laborCost, setLaborCost] = useState('');
  const [materialsBudget, setMaterialsBudget] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      name,
      mode,
      totalBudget: mode === 'all-inclusive' ? totalBudget : null,
      totalCost: mode === 'all-inclusive' ? totalCost : null,
      laborBudget: mode === 'separate' ? laborBudget : null,
      laborCost: mode === 'separate' ? laborCost : null,
      materialsBudget: mode === 'separate' ? materialsBudget : null
    });
  };

  return (
    <form onSubmit={handleSubmit}>
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
        <label style={styles.label}>Category Type</label>
        <div style={styles.modeToggle}>
          <div
            style={{
              ...styles.modeOption,
              ...(mode === 'all-inclusive' ? styles.modeOptionActive : {})
            }}
            onClick={() => setMode('all-inclusive')}
          >
            <div style={styles.modeTitle}>All-Inclusive</div>
            <div style={styles.modeDesc}>Sub handles everything for one price</div>
          </div>
          <div
            style={{
              ...styles.modeOption,
              ...(mode === 'separate' ? styles.modeOptionActive : {})
            }}
            onClick={() => setMode('separate')}
          >
            <div style={styles.modeTitle}>Separate Labor/Materials</div>
            <div style={styles.modeDesc}>You handle materials separately</div>
          </div>
        </div>
      </div>

      {mode === 'all-inclusive' ? (
        <>
          <div style={styles.formGroup}>
            <label style={styles.label}>Total Budget (what client pays)</label>
            <input
              style={styles.input}
              type="number"
              value={totalBudget}
              onChange={e => setTotalBudget(e.target.value)}
              placeholder="30000"
              required
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Your Cost (what you pay sub)</label>
            <input
              style={styles.input}
              type="number"
              value={totalCost}
              onChange={e => setTotalCost(e.target.value)}
              placeholder="22000"
              required
            />
          </div>
          {totalBudget && totalCost && (
            <div style={styles.formGroup}>
              <div style={styles.profitPreview}>
                Projected Profit: <span style={{color: '#10b981'}}>${(parseFloat(totalBudget) - parseFloat(totalCost)).toLocaleString()}</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={styles.formSectionLabel}>LABOR (your margin)</div>
          <div style={{...styles.formRow, padding: '0 24px'}}>
            <div style={{...styles.formGroup, padding: 0, flex: 1}}>
              <label style={styles.label}>Labor Budget (client pays)</label>
              <input
                style={styles.input}
                type="number"
                value={laborBudget}
                onChange={e => setLaborBudget(e.target.value)}
                placeholder="45000"
                required
              />
            </div>
            <div style={{...styles.formGroup, padding: 0, flex: 1}}>
              <label style={styles.label}>Labor Cost (you pay sub)</label>
              <input
                style={styles.input}
                type="number"
                value={laborCost}
                onChange={e => setLaborCost(e.target.value)}
                placeholder="32000"
                required
              />
            </div>
          </div>
          {laborBudget && laborCost && (
            <div style={styles.formGroup}>
              <div style={styles.profitPreview}>
                Labor Profit: <span style={{color: '#10b981'}}>${(parseFloat(laborBudget) - parseFloat(laborCost)).toLocaleString()}</span>
              </div>
            </div>
          )}

          <div style={styles.formSectionLabel}>MATERIALS (pass-through)</div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Materials Budget (client pays actual cost)</label>
            <input
              style={styles.input}
              type="number"
              value={materialsBudget}
              onChange={e => setMaterialsBudget(e.target.value)}
              placeholder="25000"
              required
            />
            <div style={styles.inputHint}>Materials are pass-through - no markup</div>
          </div>
        </>
      )}

      <div style={styles.formActions}>
        <button type="button" style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button type="submit" style={styles.submitBtn}>Add Category</button>
      </div>
    </form>
  );
};

const NewPaymentForm = ({ categories, onSubmit, onCancel }) => {
  const [paymentMethod, setPaymentMethod] = useState('check');
  const [reference, setReference] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState(
    categories.map(c => ({
      categoryId: c.id,
      mode: c.mode || 'all-inclusive',
      amount: '',       // for all-inclusive
      laborAmount: '',  // for separate
      materialsAmount: '' // for separate
    }))
  );

  // Calculate total allocated considering both modes
  const allocatedTotal = allocations.reduce((sum, a) => {
    if (a.mode === 'separate') {
      return sum + (parseFloat(a.laborAmount) || 0) + (parseFloat(a.materialsAmount) || 0);
    }
    return sum + (parseFloat(a.amount) || 0);
  }, 0);
  const remaining = (parseFloat(totalAmount) || 0) - allocatedTotal;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      paymentMethod,
      reference,
      totalAmount,
      date,
      notes,
      allocations: allocations.map(a => ({
        categoryId: a.categoryId,
        amount: a.mode === 'all-inclusive' ? (parseFloat(a.amount) || 0) : 0,
        laborAmount: a.mode === 'separate' ? (parseFloat(a.laborAmount) || 0) : 0,
        materialsAmount: a.mode === 'separate' ? (parseFloat(a.materialsAmount) || 0) : 0
      }))
    });
  };

  const paymentMethods = [
    { value: 'check', label: 'Check' },
    { value: 'zelle', label: 'Zelle' },
    { value: 'cash', label: 'Cash' },
    { value: 'other', label: 'Other' }
  ];

  return (
    <form onSubmit={handleSubmit}>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Payment Method</label>
          <select
            style={styles.input}
            value={paymentMethod}
            onChange={e => setPaymentMethod(e.target.value)}
          >
            {paymentMethods.map(pm => (
              <option key={pm.value} value={pm.value}>{pm.label}</option>
            ))}
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>
            {paymentMethod === 'check' ? 'Check #' : 'Reference'}
          </label>
          <input
            style={styles.input}
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder={paymentMethod === 'check' ? '1234' : 'Confirmation #'}
          />
        </div>
      </div>
      <div style={styles.formRow}>
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

      <div style={styles.allocationSection}>
        <label style={styles.label}>Allocate to Categories</label>

        {/* Header row for separate mode */}
        {categories.some(c => (c.mode || 'all-inclusive') === 'separate') && (
          <div style={styles.allocationHeaderRow}>
            <span style={{flex: 1}}>Category</span>
            <span style={{width: '80px', textAlign: 'center', fontSize: '11px'}}>Labor</span>
            <span style={{width: '80px', textAlign: 'center', fontSize: '11px'}}>Materials</span>
          </div>
        )}

        {categories.map((cat, idx) => {
          const catMode = cat.mode || 'all-inclusive';
          return (
            <div key={cat.id} style={styles.allocationRow}>
              <span style={styles.allocationCatName}>
                {cat.name}
                <span style={styles.modeBadge}>
                  {catMode === 'separate' ? 'Sep' : 'All'}
                </span>
              </span>
              {catMode === 'separate' ? (
                <div style={styles.allocationInputs}>
                  <input
                    style={{...styles.input, width: '80px'}}
                    type="number"
                    value={allocations[idx].laborAmount}
                    onChange={e => {
                      const newAllocs = [...allocations];
                      newAllocs[idx].laborAmount = e.target.value;
                      setAllocations(newAllocs);
                    }}
                    placeholder="0"
                  />
                  <input
                    style={{...styles.input, width: '80px'}}
                    type="number"
                    value={allocations[idx].materialsAmount}
                    onChange={e => {
                      const newAllocs = [...allocations];
                      newAllocs[idx].materialsAmount = e.target.value;
                      setAllocations(newAllocs);
                    }}
                    placeholder="0"
                  />
                </div>
              ) : (
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
              )}
            </div>
          );
        })}
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
  const [expenseType, setExpenseType] = useState('labor');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [reference, setReference] = useState('');

  const selectedCategory = categories.find(c => c.id === parseInt(categoryId) || c.id === categoryId);
  const isSeparateMode = selectedCategory && (selectedCategory.mode === 'separate');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      categoryId: parseInt(categoryId) || categoryId,
      amount,
      date,
      description,
      type: isSeparateMode ? expenseType : null,
      paymentMethod: paymentMethod || null,
      reference: reference || null
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Category</label>
        <select
          style={styles.input}
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
          required
        >
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>
              {cat.name} ({(cat.mode || 'all-inclusive') === 'separate' ? 'Separate' : 'All-Inclusive'})
            </option>
          ))}
        </select>
      </div>

      {isSeparateMode && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Expense Type</label>
          <div style={styles.typeToggle}>
            <button
              type="button"
              style={{
                ...styles.typeBtn,
                ...(expenseType === 'labor' ? styles.typeBtnActive : {})
              }}
              onClick={() => setExpenseType('labor')}
            >
              Labor
            </button>
            <button
              type="button"
              style={{
                ...styles.typeBtn,
                ...(expenseType === 'materials' ? styles.typeBtnActiveMaterials : {})
              }}
              onClick={() => setExpenseType('materials')}
            >
              Materials
            </button>
          </div>
        </div>
      )}

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

      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Payment Method (optional)</label>
          <select
            style={styles.input}
            value={paymentMethod}
            onChange={e => setPaymentMethod(e.target.value)}
          >
            <option value="">-- Select --</option>
            <option value="check">Check</option>
            <option value="zelle">Zelle</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Reference # (optional)</label>
          <input
            style={styles.input}
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="Check # or confirmation"
          />
        </div>
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
    gridTemplateColumns: 'repeat(6, 1fr)',
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
  // Mode toggle styles
  modeToggle: {
    display: 'flex',
    gap: '4px',
    padding: '4px',
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  modeToggleBtn: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#64748b',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  modeToggleBtnActive: {
    backgroundColor: '#334155',
    color: '#f1f5f9',
  },
  // Warning dot indicator
  warningDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  // Mode badges
  modeBadge: {
    fontSize: '10px',
    fontWeight: '600',
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: '#334155',
    color: '#94a3b8',
    marginLeft: '8px',
  },
  modeBadgeSmall: {
    fontSize: '9px',
    fontWeight: '700',
    padding: '2px 5px',
    borderRadius: '3px',
    backgroundColor: '#334155',
    color: '#64748b',
    letterSpacing: '0.5px',
  },
  // Sub-section for separate mode cards
  subSection: {
    marginBottom: '8px',
  },
  subSectionTitle: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  // Allocation header row for payment form
  allocationHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #334155',
    marginBottom: '8px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  // Allocation inputs container
  allocationInputs: {
    display: 'flex',
    gap: '8px',
  },
  // Type toggle for expense form
  typeToggle: {
    display: 'flex',
    gap: '8px',
    marginTop: '8px',
  },
  typeToggleBtn: {
    flex: 1,
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid #334155',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  typeToggleBtnActive: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    color: '#3b82f6',
  },
  typeBtn: {
    flex: 1,
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid #334155',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  typeBtnActive: {
    borderColor: '#8b5cf6',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    color: '#a78bfa',
  },
  typeBtnActiveMaterials: {
    borderColor: '#06b6d4',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    color: '#22d3ee',
  },
  // Expense type badge
  typeBadge: {
    fontSize: '10px',
    fontWeight: '600',
    padding: '3px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  typeBadgeLabor: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    color: '#a78bfa',
  },
  typeBadgeMaterials: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    color: '#22d3ee',
  },
  // Health indicators for dashboard
  healthIndicators: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '8px',
  },
  healthBadgeRed: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#ef4444',
  },
  healthBadgeYellow: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    color: '#eab308',
  },
  healthBadgeGreen: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    color: '#22c55e',
  },
};

export default ContractorCRM;
