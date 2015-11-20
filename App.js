/**
 * Change Log Annotation Tool
 * 
 * Written during Rally Hackathon on 16.10.2015 in Amsterdam
 * Mostly by John Martin <curmudgeon@rallydev.com> with some help from Daniel Lorch <daniel.lorch@swisscom.com>
 */

/* global Ext, Deft, Rally */
Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: [
        {
            xtype: 'container',
            region: 'north',
            itemId: 'selectorsContainer',
            layout: { type:'hbox' },
            padding: 5
        },{
            xtype: 'container',
            region: 'center',
            layout: 'fit',
            itemId: 'gridContainer'
        }
    ],
    layout: {type: 'border'},
    /**
     * Configurable fields
     */
    _lookBackDataFetchLimit: 400, // hard-limit the maximal number of individual change objects we fetch from Lookback API
    _preferencesPrefix: 'com.swisscom.tv20.changelog_', // as a convention, we will prefix all our Preferences objects with this value
    _dateFormat: 'm/d/Y g:i A',
    _onlyShowValuesNewerThan: '2015-09-28', // this is the date we activate this app, so ignore older values than this date
    /**
     * App Methods
     */
    launch: function() {
        this._fetchAllDataAndDisplayGrid();
    },
    _fetchAllDataAndDisplayGrid: function() {
        var me = this;
        
        this.setLoading("Loading Data");
        
        Deft.Chain.sequence([this._fetchLookbackData, this._fetchPreferenceModel, this._fetchUsers, this._fetchPreferencesData], this).then({ // scoping `this' to the app
            success: function(data) {
                var lookbackData = data[0];
                this._preferenceModel = data[1];
                this._usersData = data[2];
                var preferencesData = data[3];
                
                var displayData = this._prepareDisplayData(lookbackData);
                this._displayDataStore = Ext.create('Rally.data.custom.Store', {
                    data: displayData,
                    listeners: {
                        scope: this,
                        load: function(store,records) {
                            this._mergePreferencesToDisplayData(records, preferencesData);
                            
                            var container = this.down('#selectorsContainer');
                            container.removeAll();
                            this._createViewDropdown(container);
                            this._createExportButton(container);
                        }
                    }
                });
                
//                this._createViewDropdown();
//                this._createExportButton();
            },
            scope: this // scope `this' in the `success' callback to the app and not the promise object
        }).always(function() { me.setLoading(false); });
    },
    _fetchLookbackData: function() {
        var deferred = Ext.create('Deft.Deferred');
        var typeFilter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_TypeHierarchy',
            operator: 'in',
            value: ['PortfolioItem/Feature']
        });
        var dateFilter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_ValidFrom',
            operator: '>',
            value: this._onlyShowValuesNewerThan
        })
//        .or(Ext.create('Rally.data.lookback.QueryFilter', {
//            property: '_ValidTo',
//            operator: '>',
//            value: this._onlyShowValuesNewerThan
//        }))
        ;
        
        var changeFilter = Rally.data.lookback.QueryFilter.or(
            [
                {
                    property: '_PreviousValues.Name',
                    operator: 'exists',
                    value: true
                },
                {
                    property: '_PreviousValues.c_MustLaunchTarget',
                    operator: 'exists',
                    value: true
                },
                {
                    property: '_PreviousValues.Release',
                    operator: 'exists',
                    value: true
                },
                { // if there are no previous values, the item has been either deleted or restored from the recycle bin
                    property: '_PreviousValues',
                    operator: 'exists',
                    value: false
                }
            ]
        );
        
        Ext.create('Rally.data.lookback.SnapshotStore', {
            listeners: {
                load: function(store, data, success) {
                    Ext.Array.each(data, function(datum){
                        console.log('--', datum.get('ObjectID'), datum.get('FormattedID'), datum);
                    });
                    deferred.resolve(data);
                }
            },
            removeUnauthorizedSnapshots: true,
            autoLoad: true,
            fetch: ['FormattedID', 'Name', '_PreviousValues', '_User', 'c_MustLaunchTarget', 'Release', 'Project', '_PreviousValues.Release', '_PreviousValues.Project', '_PreviousValues.c_MustLaunchTarget', '_PreviousValues.Name'],
            hydrate: ['Release', 'Project', '_PreviousValues.Release', '_PreviousValues.Project'],
            filters: typeFilter.and(dateFilter).and(changeFilter),
            sorters: [
                {
                    property: '_ValidFrom',
                    direction: 'DESC'
                }
            ],
            pageSize: this._lookBackDataFetchLimit
        });
        
        return deferred.promise;
    },
    _fetchPreferencesData: function() {
        var deferred = Ext.create('Deft.Deferred');
        
        Ext.create('Rally.data.wsapi.Store', {
            model: 'Preference',
            autoLoad: true,
            fetch: ['Name', 'Value'],
            listeners: {
                load: function(store, data, success) {
                    var preferenceHash = {};
                    
                    Ext.Array.each(data, function(preference) {
                        preferenceHash[preference.get('Name')] = preference;   
                    });

                    deferred.resolve(preferenceHash);
                }
            },
            filters: [
                {
                    property: 'Name',
                    operator: 'contains',
                    value: this._preferencesPrefix 
                }
            ],
            limit: Infinity
        });
        
        return deferred.promise;
    },
    _fetchPreferenceModel: function() {
        var deferred = Ext.create('Deft.Deferred');
        
        Rally.data.ModelFactory.getModel({
            type: 'Preference',
            success: function(model) {
                deferred.resolve(model);
            }
        });
        
        return deferred.promise;
    },
    _fetchUsers: function() {
        var deferred = Ext.create('Deft.Deferred');
        
        Ext.create('Rally.data.wsapi.Store', {
            model: 'User',
            autoLoad: true,
            fetch: ['ObjectID'],
            listeners: {
                load: function(store, data, success) {
                    var usersHash = {};
                    
                    Ext.Array.each(data, function(user) {
                        usersHash[user.get('ObjectID')] = user;   
                    });

                    deferred.resolve(usersHash);
                }
            },
            limit: Infinity
        });
        
        return deferred.promise;
    },
    
    _prepareDisplayData: function(lookbackData) {
        var displayData = [];

        Ext.Array.each(lookbackData, function(snapshot) {
            displayData.push({
                Preference: {},
                FeatureOID: snapshot.get('ObjectID'),
                ProjectOID: snapshot.get('Project'),
                ValidFrom: snapshot.get('_ValidFrom'),
                FormattedID: snapshot.get('FormattedID'),
                FeatureName: snapshot.get('Name'),
                User: snapshot.get('_User'),
                RallyChangeReason: this._extractRallyChangeReason(snapshot),
                ChangeDescription: null,
                Ignore: false,
                ReviewedByCoreTeam: false,
                ReviewedByProductCouncil: false
            });
        }, this); // `this' scopes to the app
        
        return displayData;
    },
    
    _mergePreferencesToDisplayData: function(records, preferencesHash) {
        var displayData = [];

        Ext.Array.each(records, function(record) {
            var preferenceName = this._preferencesPrefix + record.get('FeatureOID') + '_' + record.get('ValidFrom');

            var preference = preferencesHash[preferenceName];
            if(!preference) {
                preference = Ext.create(this._preferenceModel, {
                    Name: preferenceName,
                    Project: this.getContext().getProject(),
                    Value: '{}'
                });
            }
            
            var preferenceValues = Ext.JSON.decode(preference.get('Value'));

            record.set('Preference', preference);
            record.set('ChangeDescription', preferenceValues.ChangeDescription);
            record.set('Ignore', preferenceValues.Ignore || false);
            record.set('ReviewedByCoreTeam', preferenceValues.ReviewedByCoreTeam || false);
            record.set('ReviewedByProductCouncil', preferenceValues.ReviewedByProductCouncil || false);
        }, this);
        return;
    },
    _extractRallyChangeReason: function(snapshot) {
        var reason = [];
        
        if(snapshot.get('_PreviousValues').Name === null) {
            reason.push('Feature CREATED');
        }
        
        if(Ext.isEmpty(snapshot.get('_PreviousValues'))) {
            if(snapshot.get('_ValidFrom') == snapshot.get('_ValidTo')) {
                reason.push('Feature DELETED');
            } else {
                reason.push('Feature RESTORED');
            }
        }
        
        if(!Ext.isEmpty(snapshot.get('_PreviousValues').Name)) {
            reason.push('NAME changed from [' + snapshot.get('_PreviousValues').Name + ']');
        }
        
        if(snapshot.get('_PreviousValues').Release !== undefined) {
            reason.push(this._rallyChangeReasonStringHelper(snapshot.get('_PreviousValues.Release'), snapshot.get('Release'), 'RELEASE', 'Name'));
        }
        
        if(snapshot.get('_PreviousValues').Project !== undefined) {
            reason.push(this._rallyChangeReasonStringHelper(snapshot.get('_PreviousValues').Project, snapshot.get('Project'), 'PROJECT', 'Name'));
        }

        if(snapshot.get('_PreviousValues').c_MustLaunchTarget !== undefined) { // "Must Launch Target" has changed
            reason.push(this._rallyChangeReasonStringHelper(snapshot.get('_PreviousValues').c_MustLaunchTarget, snapshot.get('c_MustLaunchTarget'), 'MUST LAUNCH TARGET'));
        }
        
        return reason.join(", ");
    },
    _rallyChangeReasonStringHelper: function(previousValue, newValue, fieldDisplayName, fieldName) {
        var result;
        
        if(Ext.isObject(previousValue)) {
            previousValue = previousValue[fieldName];
        }
        
        if(Ext.isObject(newValue)) {
            newValue = newValue[fieldName];
        }

        if(Ext.isEmpty(previousValue)) {
            if(!Ext.isEmpty(newValue)) {
                result = fieldDisplayName + " added [" + newValue + "]";
            }
        } else {
            if(Ext.isEmpty(newValue)) {
                result = fieldDisplayName + " of [" + previousValue + "] removed";
            } else {
                result = fieldDisplayName + " changed from [" + previousValue + "] to [" + newValue + "]";
            }
        }
        
        return result;
    },
    _createExportButton: function(container) {
        container.add({
            xtype:'container',
            flex: 1
        });
        
        container.add({
            xtype:'rallybutton',
            itemId:'exportButton',
            text: '<span class="icon-export"> </span>',
            disabled: this.down('combo') && this.down('combo').getValue=="All Items",
            listeners: {
                scope: this,
                click: function() {
                    this._export();
                }
            }
        });
    },
    _createViewDropdown: function(container) {
        var views = Ext.create('Ext.data.Store', {
            fields: ['name'],
            data: [
                {name: 'All Items'},
                {name: 'To Be Reviewed Core Team'},
                {name: 'To Be Reviewed Product Council'}
            ]
        });
        
        container.add({
            xtype: 'combo',
            fieldLabel: 'Filter:',
            labelWidth: 35,
            store: views,
            queryMode: 'local',
            displayField: 'name',
            valueField: 'name',
            //value: 'All Items',
            
            stateful: true, // remember selection
            stateEvents: [
                'change'
            ],
            stateId: this._preferencesPrefix + 'filter',
            listeners: {
                
                change: function(combobox, newValue, oldValue, eOpts) {
                    var button = this.down('rallybutton');
                    if (button) {
                        button.setDisabled(true);
                        if (newValue == "All Items") {
                            button.setDisabled(false);
                        }
                    }
                    
                    this._createGrid(newValue);
                },
                scope: this
            }
        });
    },
    _createGrid: function(view) {

        var gridContainer = this.down('#gridContainer');
        var myColumnCfg = [];
        var self = this;
        
        var validFromRow = {dataIndex: 'ValidFrom', text: 'When', renderer: Ext.util.Format.dateRenderer(this._dateFormat)};
        var userRow = {dataIndex: 'User', text: 'Who', renderer: function(value) {
            var user = self._usersData[value];
            if(user) {
                return self._usersData[value].get('_refObjectName');
            } else {
                return '(Deleted User)';
            }
        }};
        var formattedIdRow = {dataIndex: 'FormattedID', text: 'Feature ID', _csvIgnoreRender: true, renderer: function(value, metaData, record) {
            return '<a href="https://rally1.rallydev.com/#/search?keywords=' + value + '" target="_blank">' + value + '</a>';
        }};
        var featureNameRow = {dataIndex: 'FeatureName', text: 'Feature Name'};
        var rallyChangeReasonRow = {dataIndex: 'RallyChangeReason', text: 'Rally Change Reason', editor: {xtype: 'rallytextfield', readOnly: true}};
        var changeDescriptionRow = {dataIndex: 'ChangeDescription', text: 'Change Description', editor: 'rallytextfield', flex: 1};
        var reviewByCoreTeamRow = {dataIndex: 'ReviewedByCoreTeam', text: 'Reviewed Core Team', editor: 'rallycheckboxfield', renderer: function(value) { return value ? "Yes" : "No"; }};
        var reviewByProductCouncilRow = {dataIndex: 'ReviewedByProductCouncil', text: 'Reviewed Product Council', editor: 'rallycheckboxfield', renderer: function(value) { return value ? "Yes" : "No"; }};
        var ignoreRow = {
            xtype: 'actioncolumn',
            width: 50,
            renderer: function (value, metadata, record, rowIndex, colIndex, store, view) {

                if (this.items && this.items.length > 0){
                    if ( record.get('Ignore') ) {
                        this.items[0].icon = "https://rally1.rallydev.com/slm/images/icon_find.gif";
                    } else {
                        this.items[0].icon = "https://rally1.rallydev.com/slm/images/icon_cancel.gif";
                    }

                }
                return '';
            },
            
            exportRenderer: function(value, metadata, record) {
                return record.get('Ignore');
            },

            items: [{
                icon: 'https://rally1.rallydev.com/slm/images/icon_cancel.gif',
                tooltip: 'Ignore Change',
                isDisabled: function(view,rowIndex,colIndex,item,record) {
                    return ( record.get('Ignored') );
                },
                handler: function(grid, rowIndex, colIndex) {
                    var record = grid.getStore().getAt(rowIndex);
                    var newValue = !record.get('Ignore');
                    
                    record.set('Ignore', newValue);
                    
                    this._updateAndSaveNewPreferenceValue(record.get('Preference'), 'Ignore', newValue);
                },
                scope: this
            }]
        };
        
        var showNotIgnoredRowsFilter = {
            property: 'Ignore',
            operator: '!=',
            value: true
        };
        
        var hasChangeDescription = {
            property: 'ChangeDescription',
            operator: '!=',
            value: null
        };

        this._displayDataStore.clearFilter();
        
        if(view == 'All Items') {
            myColumnCfg = [validFromRow, userRow, formattedIdRow, featureNameRow, rallyChangeReasonRow, changeDescriptionRow, reviewByCoreTeamRow, reviewByProductCouncilRow, ignoreRow];
        } else if(view == 'To Be Reviewed Core Team') {
            myColumnCfg = [validFromRow, userRow, formattedIdRow, featureNameRow, changeDescriptionRow, reviewByCoreTeamRow]; 
            this._displayDataStore.addFilter(showNotIgnoredRowsFilter);
            this._displayDataStore.addFilter(hasChangeDescription);
            this._displayDataStore.addFilter({
                property: 'ReviewedByCoreTeam',
                operator: '!=',
                value: true
            });
        } else if(view == 'To Be Reviewed Product Council') {
            myColumnCfg = [validFromRow, userRow, formattedIdRow, featureNameRow, changeDescriptionRow, reviewByProductCouncilRow];
            this._displayDataStore.addFilter(showNotIgnoredRowsFilter);
            this._displayDataStore.addFilter(hasChangeDescription);
            this._displayDataStore.addFilter({
                property: 'ReviewedByProductCouncil',
                operator: '!=',
                value: true
            });
        }

        gridContainer.removeAll();
        gridContainer.add({
            xtype: 'rallygrid',
            viewConfig: {
                getRowClass: function(record) {
                    if(record && record.get('Ignore') === true) return 'disabled-row';
                }
            },
            store: this._displayDataStore,
            columnCfgs: myColumnCfg,
            sortableColumns: false, // prevent sorting, since firstly results seem to be wrong (items collapse when a filter is applied), and also because we have a fetch limit in place and thus the result limit is arbitrary
            listeners: {
                edit: function(editor, evt) {
                    if(evt.value != evt.originalValue) { // after editing a field, focus goes to the next row and causes this event to trigger. ignore this event.
                        if(Ext.Array.contains(['ChangeDescription', 'ReviewedByCoreTeam', 'ReviewedByProductCouncil', 'Ignore'], evt.field)) {
                            this._updateAndSaveNewPreferenceValue(evt.record.get('Preference'), evt.field, evt.record.get(evt.field));
                        }
                    }
                },
                scope: this
            }
        });
    },
    _updateAndSaveNewPreferenceValue: function(preference, field, newValue) {
        var preferenceValues = Ext.JSON.decode(preference.get('Value'));
        preferenceValues[field] = newValue;

        preference.set('Value', Ext.JSON.encode(preferenceValues));
        preference.save({
            callback: function(result, operation) {
                if(!operation.wasSuccessful()) {
                    Ext.Msg.alert("Problem", "Saving failed");
                }
            }
        });
    },
    
    _export: function(){
        var grid = this.down('rallygrid');
        var me = this;
        
        if ( !grid ) { return; }
        
        if(this._lookBackDataFetchLimit < 500) {
            Ext.Msg.alert("Warning", "The number of records exported is limited to " + this._lookBackDataFetchLimit + ". If you need a complete data dump, please increase the value for _lookBackDataFetchLimit in the app's source code.");
        }
        
        var filename = Ext.String.format('changelog.csv');

        this.setLoading("Generating CSV");
        Deft.Chain.sequence([
            function() { return Rally.technicalservices.FileUtilities.getCSVFromGrid(this,grid); } 
        ]).then({
            scope: this,
            success: function(csv){
                if (csv && csv.length > 0){
                    Rally.technicalservices.FileUtilities.saveCSVToFile(csv,filename);
                } else {
                    Rally.ui.notify.Notifier.showWarning({message: 'No data to export'});
                }
                
            }
        }).always(function() { me.setLoading(false); });
    }
});