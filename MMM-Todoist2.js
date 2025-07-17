/* global Module */

/* Magic Mirror
 * Module: MMM-Todoist2
 *
 * Managed by Zach Raudebaugh
 * Fork of MMM-Todoist by Chris Brooker
 *
 * MIT Licensed.
 */

/*
 * Update by 19ZachR 24/5/2025
 * - Updated Todoist API URI
 * Update by mabahj 24/11/2019
 * - Added support for labels in addtion to projects
 * Update by AgP42 the 18/07/2018
 * Modification added :
 * - Management of a PIR sensor with the module MMM-PIR-Sensor (by PaViRo). In case PIR module detect no user,
 * the update of the ToDoIst is stopped and will be requested again at the return of the user
 * - Management of the "module.hidden" by the core system : same behaviour as "User_Presence" by the PIR sensor
 * - Add "Loading..." display when the infos are not yet loaded from the server
 * - Possibility to add the last update time from server at the end of the module.
 * This can be configured using "displayLastUpdate" and "displayLastUpdateFormat"
 * - Possibility to display long task on several lines(using the code from default module "calendar".
 * This can be configured using "wrapEvents" and "maxTitleLength"
 *
 * // Update 27/07/2018 :
 * - Correction of start-up update bug
 * - correction of regression on commit #28 for tasks without dueDate
 * */

//UserPresence Management (PIR sensor)
var UserPresence = true; //true by default, so no impact for user without a PIR sensor

Module.register("MMM-Todoist2", {

	defaults: {
		maximumEntries: 10,
		projects: [],
		blacklistProjects: false,
	    	labels: [""],
		updateInterval: 10 * 60 * 1000, // every 10 minutes,
		fade: true,
		fadePoint: 0.25,
		fadeMinimumOpacity: 0.25,

		// New config specific to MMM-Todoist2
		groupByProject: false,

		//New config from AgP42
		displayLastUpdate: false, //add or not a line after the tasks with the last server update time
		displayLastUpdateFormat: "ddd - HH:mm:ss", //format to display the last update. See Moment.js documentation for all display possibilities
		maxTitleLength: 25, //10 to 50. Value to cut the line if wrapEvents: true
		wrapEvents: false, // wrap events to multiple lines breaking at maxTitleLength
		displayTasksWithoutDue: true, // Set to false to not print tasks without a due date
		displayTasksWithinDays: -1, // If >= 0, do not print tasks with a due date more than this number of days into the future (e.g., 0 prints today and overdue)
		// 2019-12-31 by thyed
		displaySubtasks: true, // set to false to exclude subtasks
		displayAvatar: false,
		showProject: true,

		//This has been designed to use the Todoist Sync API.
		apiVersion: "v1",
		apiBase: "https://api.todoist.com/api",
		todoistEndpoint: "sync",

		todoistResourceType: "[\"items\", \"projects\", \"collaborators\", \"user\", \"labels\"]",

		debug: false,

		// Updated: sortType is now an array of sort keys
		sortOrder: ["todoist"]
	},

	// Define required scripts.
	getStyles: function () {
		return ["MMM-Todoist2.css"];
	},
	getTranslations: function () {
		return {
			en: "translations/en.json",
			de: "translations/de.json",
			nb: "translations/nb.json"
		};
	},

	start: function () {
		var self = this;
		Log.info("Starting module: " + this.name);

		this.updateIntervalID = 0; // Definition of the IntervalID to be able to stop and start it again
		this.ModuleToDoIstHidden = false; // by default it is considered displayed. Note : core function "this.hidden" has strange behaviour, so not used here

		//to display "Loading..." at start-up
		this.title = "Loading...";
		this.loaded = false;

		if (this.config.accessToken === "") {
			Log.error("MMM-Todoist: AccessToken not set!");
			return;
		}

		//Support legacy properties
		if (this.config.lists !== undefined) {
			if (this.config.lists.length > 0) {
				this.config.projects = this.config.lists;
			}
		}

		// keep track of user's projects list (used to build the "whitelist")
		this.userList = typeof this.config.projects !== "undefined" ? JSON.parse(JSON.stringify(this.config.projects)) : [];

		this.sendSocketNotification("FETCH_TODOIST", this.config);

		//add ID to the setInterval function to be able to stop it later on
		this.updateIntervalID = setInterval(function () {
			self.sendSocketNotification("FETCH_TODOIST", self.config);
		}, this.config.updateInterval);
	},

	suspend: function () { //called by core system when the module is not displayed anymore on the screen
		this.ModuleToDoIstHidden = true;
		//Log.log("Fct suspend - ModuleHidden = " + ModuleHidden);
		this.GestionUpdateIntervalToDoIst();
	},

	resume: function () { //called by core system when the module is displayed on the screen
		this.ModuleToDoIstHidden = false;
		//Log.log("Fct resume - ModuleHidden = " + ModuleHidden);
		this.GestionUpdateIntervalToDoIst();
	},

	notificationReceived: function (notification, payload) {
		if (notification === "USER_PRESENCE") { // notification sended by module MMM-PIR-Sensor. See its doc
			//Log.log("Fct notificationReceived USER_PRESENCE - payload = " + payload);
			UserPresence = payload;
			this.GestionUpdateIntervalToDoIst();
		}
	},

	// Additional support for MMM-PIR-Sensor to detect when there is movement in front of the mirror
	GestionUpdateIntervalToDoIst: function () {
		if (UserPresence === true && this.ModuleToDoIstHidden === false) {
			var self = this;

			// update now
			this.sendSocketNotification("FETCH_TODOIST", this.config);

			//if no IntervalID defined, we set one again. This is to avoid several setInterval simultaneously
			if (this.updateIntervalID === 0) {

				this.updateIntervalID = setInterval(function () {
					self.sendSocketNotification("FETCH_TODOIST", self.config);
				}, this.config.updateInterval);
			}

		} else { //if (UserPresence = false OR ModuleHidden = true)
			Log.log("Nobody is looking, stop updating " + this.name + " project : " + this.config.projects);
			clearInterval(this.updateIntervalID); // stop the update interval of this module
			this.updateIntervalID = 0; //reset the flag to be able to start another one at resume
		}
	},

	// Code from MichMich from default module Calendar : to manage task displayed on several lines
	/**
	 * Shortens a string if it's longer than maxLength and add a ellipsis to the end
	 *
	 * @param {string} string Text string to shorten
	 * @param {number} maxLength The max length of the string
	 * @param {boolean} wrapEvents Wrap the text after the line has reached maxLength
	 * @returns {string} The shortened string
	 */
	shorten: function (string, maxLength, wrapEvents) {
		if (typeof string !== "string") {
			return "";
		}

		if (wrapEvents === true) {
			var temp = "";
			var currentLine = "";
			var words = string.split(" ");

			for (var i = 0; i < words.length; i++) {
				var word = words[i];
				if (currentLine.length + word.length < (typeof maxLength === "number" ? maxLength : 25) - 1) { // max - 1 to account for a space
					currentLine += (word + " ");
				} else {
					if (currentLine.length > 0) {
						temp += (currentLine + "<br>" + word + " ");
					} else {
						temp += (word + "<br>");
					}
					currentLine = "";
				}
			}

			return (temp + currentLine).trim();
		} else {
			if (maxLength && typeof maxLength === "number" && string.length > maxLength) {
				return string.trim().slice(0, maxLength) + "&hellip;";
			} else {
				return string.trim();
			}
		}
	},
	//end modif AgP

	// Override socket notification handler.
	// ******** Data sent from the Backend helper. This is the data from the Todoist API ************
	socketNotificationReceived: function (notification, payload) {
		if (notification === "TASKS") {
			this.filterTodoistData(payload);

			if (this.config.displayLastUpdate) {
				this.lastUpdate = Date.now() / 1000; //save the timestamp of the last update to be able to display it
				Log.log("ToDoIst update OK, project : " + this.config.projects + " at : " + moment.unix(this.lastUpdate).format(this.config.displayLastUpdateFormat)); //AgP
			}

			this.loaded = true;
			this.updateDom(1000);
		} else if (notification === "FETCH_ERROR") {
			Log.error("Todoist Error. Could not fetch todos: " + payload.error);
		}
	},

	filterTodoistData: function (tasks) {
		var self = this;
		var items = [];
		var labelIds = [];

		if (tasks == undefined) return; 
		if (tasks.accessToken != self.config.accessToken) return;
		if (tasks.items == undefined) return;

		// If groupByProjects is true, we need to ensure "project" is the first element in sortOrder
		// otherwise the sort will be incorrect after the grouping
		if (this.config.groupByProject && this.config.sortOrder[0] !== "project") {
			var array = this.config.sortOrder;
			if (array.includes("project")) {
				// sortOrder contains project, but it isn't first
				var i = array.indexOf("project");

				// remove "project" from array
				const element = array.splice(i, 1)[0];

				// add "project" to front
				array.unshift(element);
			}
			else {
				// add "project" to front
				array.unshift("project");
			}

			// update config
			this.config.sortOrder = array;
		}

		if (this.config.blacklistProjects) {
			// take all projects in payload, and remove the ones specified by user
			// i.e., convert user's "whitelist" into a "blacklist"
			this.config.projects = [];
			tasks.projects.forEach(project => {
				if(this.userList.includes(project.id)) {
					return; // blacklisted
				}
				this.config.projects.push(project.id);
			});
			if(self.config.debug) {
				console.log("MMM-Todoist: original list of projects was blacklisted.\n" +
					"Only considering the following projects:");
				console.log(this.config.projects);
			}
		}

		/* Not needed for labels, but kept for reuse elsewhere
		// Loop through labels fetched from API and find corresponding label IDs for task filtering
		// Could be re-used for project names -> project IDs.
		if (self.config.labels.length>0 && tasks.labels != undefined) {
			for (let apiLabel of tasks.labels) {
				for (let configLabelName of self.config.labels) {
					if (apiLabel.name == configLabelName) {
						labelIds.push(apiLabel.id);
						break;
					}
				}
			}
		}
		*/

		if (self.config.displayTasksWithinDays > -1 || !self.config.displayTasksWithoutDue) {
			tasks.items = tasks.items.filter(function (item) {
				if (item.due === null) {
					return self.config.displayTasksWithoutDue;
				}

				var oneDay = 24 * 60 * 60 * 1000;
				var dueDateTime = self.parseDueDate(item.due.date);
				var dueDate = new Date(dueDateTime.getFullYear(), dueDateTime.getMonth(), dueDateTime.getDate());
				var now = new Date();
				var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
				var diffDays = Math.floor((dueDate - today) / (oneDay));
				return diffDays <= self.config.displayTasksWithinDays;
			});
		}

		//Filter the Todos by the criteria specified in the Config
		tasks.items.forEach(function (item) {
			// Ignore sub-tasks
			if (item.parent_id!=null && !self.config.displaySubtasks) { return; }

			// Filter using label if a label is configured
			if (self.config.labels.length > 0 && item.labels.length > 0) {
        			// Check all the labels assigned to the task. Add to items if match with configured label
        			for (let label of item.labels) {
          				for (let labelName of self.config.labels) {
            					if (label == labelName) { //the string returned from SyncAPI matches the strong in config
              						items.push(item);
              						return;
            					}
          				}
        			}
      			}

			// Filter using projets if projects are configured
			if (self.config.projects.length>0){
			  self.config.projects.forEach(function (project) {
			  		if (item.project_id == project) {
						items.push(item);
						return;
					}
			  });
			}
		});

		//**** FOR DEBUGGING TO HELP PEOPLE GET THEIR PROJECT IDs */
		if (self.config.debug) {
			console.log("%c *** PROJECT -- ID ***", "background: #222; color: #bada55");
			tasks.projects.forEach(project => {
				console.log("%c" + project.name + " -- " + project.id, "background: #222; color: #bada55");
			});
		};
		//****** */

		//Used for ordering by date
		items.forEach(function (item) {
			if (item.due === null) {
				item.due = {};
				item.due["date"] = "2100-12-31";
				item.all_day = true;
			}
			// Used to sort by date.
			item.date = self.parseDueDate(item.due.date);

			// as v8 API does not have 'all_day' field anymore then check due.date for presence of time
			// if due.date has a time then set item.all_day to false else all_day is true
			if (item.due.date.length > 10) {
				item.all_day = false;
			} else {
				item.all_day = true;
			}
		});

		//***** Sorting code if you want to add new methods. */
		// Multi-level sorting using sortOrder array
		function getComparator(type) {
			switch (type) {
				case "todoist":
					return self.sortByTodoistComparator;
				case "project":
					return self.sortByProjectComparator;
				case "priority":
					return self.sortByPriorityComparator;
				case "dueDateAsc":
					return self.sortByDueDateAscComparator;
				case "dueDateDesc":
					return self.sortByDueDateDescComparator;
				default:
					return function() { return 0; };
			}
		}

		// Sort by the specified sort types using their comparator functions
		var sortTypes = Array.isArray(self.config.sortOrder) ? self.config.sortOrder : [self.config.sortOrder];
		items.sort(function(a, b) {
			for (var i = 0; i < sortTypes.length; i++) {
				var cmp = getComparator(sortTypes[i])(a, b);
				if (cmp !== 0) return cmp;
			}
			return 0;
		});

		//Slice by max Entries
		items = items.slice(0, this.config.maximumEntries);

		// Group by project
		if (self.config.groupByProject) {
			
		}

		this.tasks = {
			"items": items,
			"projects": tasks.projects,
			"collaborators": tasks.collaborators
		};

	},
	/*
	 * The Todoist API returns task due dates as strings in these two formats: YYYY-MM-DD and YYYY-MM-DDThh:mm:ss
	 * This depends on whether a task only has a due day or a due day and time. You cannot pass this date string into
	 * "new Date()" - it is inconsistent. In one format, the date string is considered to be in UTC, the other in the
	 * local timezone. Additionally, if the task's due date has a timezone set, it is given in UTC (zulu format),
	 * otherwise it is local time. The parseDueDate function keeps Dates consistent by interpreting them all relative
	 * to the same timezone.
	 */
	parseDueDate: function (date) {
		let [year, month, day, hour = 0, minute = 0, second = 0] = date.split(/\D/).map(Number);

		// If the task's due date has a timezone set (as opposed to the default floating timezone), it's given in UTC time.
		if (date[date.length -1] === "Z") {
			return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
		}

		return new Date(year, month - 1, day, hour, minute, second);
	},
	sortByTodoistComparator: function(a, b) {
		if (!a.parent_id && !b.parent_id) { // neither have parent_id so both are parent tasks, sort by their id
			return a.id - b.id;
		} 
		else if (a.parent_id === b.parent_id) { // both are children of the same parent task, sort by child order
			return a.child_order - b.child_order;
		} 
		else if (a.parent_id === b.id) { // a is a child of b, so it goes after b
			return 1;
		} 
		else if (b.parent_id === a.id) { // b is a child of a, so it goes after a
			return -1;
		} 
		else if (!a.parent_id) { // a is a parent task, b is a child (but not of a), so compare a to b's parent
			return a.id - b.parent_id;
		} 
		else if (!b.parent_id) { // b is a parent task, a is a child (but not of b), so compare b to a's parent
			return a.parent_id - b.id;
		} 
		else { // both are child tasks, but with different parents so sort by their parents
			return a.parent_id - b.parent_id;
		}
	},
	sortByProjectComparator: function(a, b) {
		return a.project_id.localeCompare(b.project_id);
	},
	sortByPriorityComparator: function(a, b) {
		return b.priority - a.priority;
	},
	sortByDueDateAscComparator: function(a, b) {
		return a.date - b.date;
	},
	sortByDueDateDescComparator: function(a, b) {
		return b.date - a.date;
	},
	createCell: function(className, innerHTML) {
		var cell = document.createElement("div");
		cell.className = "col " + className;
		cell.innerHTML = innerHTML;
		return cell;
	},
	createHeader: function(className, innerHTML, style) {
		var row = document.createElement("div");
		row.className = "row projectheader " + className;
		row.innerHTML = innerHTML;
		row.style = style;
		return row;
	},
	addPriorityIndicatorCell: function(item) {
		var className = "priority ";
		switch (item.priority) {
			case 4:
				className += "priority1";
				break;
			case 3:
				className += "priority2";
				break;
			case 2:
				className += "priority3";
				break;
			default:
				className += "";
				break;
		}
		return this.createCell(className, "&nbsp;");;
	},
	addTodoTextCell: function(item) {
		var temp = document.createElement('div');
		temp.innerHTML = item.contentHtml;

		var para = temp.getElementsByTagName('p');
		var taskText = para[0].innerHTML;
		// if sorting by todoist, indent subtasks under their parents
		if (this.config.sortOrder.includes("todoist") && item.parent_id) {
			// this item is a subtask so indent it
			taskText = '- ' + taskText;
		}
		return this.createCell("title bright alignLeft", 
			this.shorten(taskText, this.config.maxTitleLength, this.config.wrapEvents));

		// return this.createCell("title bright alignLeft", item.content);
	},
	addDueDateCell: function(item) {
		var className = "bright align-right dueDate ";
		var innerHTML = "";
		
		var oneDay = 24 * 60 * 60 * 1000;
		var dueDateTime = this.parseDueDate(item.due.date);
		var dueDate = new Date(dueDateTime.getFullYear(), dueDateTime.getMonth(), dueDateTime.getDate());
		var now = new Date();
		var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		var diffDays = Math.floor((dueDate - today) / (oneDay));
		var diffMonths = (dueDate.getFullYear() * 12 + dueDate.getMonth()) - (now.getFullYear() * 12 + now.getMonth());

		if (diffDays < -1) {
			innerHTML = dueDate.toLocaleDateString(config.language, {
												"month": "short"
											}) + " " + dueDate.getDate();
			className += "xsmall overdue";
		} else if (diffDays === -1) {
			innerHTML = this.translate("YESTERDAY");
			className += "xsmall overdue";
		} else if (diffDays === 0) {
			innerHTML = this.translate("TODAY");
			if (item.all_day || dueDateTime >= now) {
				className += "xsmall today";
			} else {
				className += "xsmall overdue";
			}
		} else if (diffDays === 1) {
			innerHTML = this.translate("TOMORROW");
			className += "xsmall tomorrow";
		} else if (diffDays < 7) {
			innerHTML = dueDate.toLocaleDateString(config.language, {
				"weekday": "short"
			});
			className += "xsmall";
		} else if (diffMonths < 7 || dueDate.getFullYear() == now.getFullYear()) {
			innerHTML = dueDate.toLocaleDateString(config.language, {
				"month": "short"
			}) + " " + dueDate.getDate();
			className += "xsmall";
		} else if (item.due.date === "2100-12-31") {
			innerHTML = "";
			className += "xsmall";
		} else {
			innerHTML = dueDate.toLocaleDateString(config.language, {
				"month": "short"
			}) + " " + dueDate.getDate() + " " + dueDate.getFullYear();
			className += "xsmall";
		}

		if (innerHTML !== "" && !item.all_day) {
			function formatTime(d) {
				function z(n) {
					return (n < 10 ? "0" : "") + n;
				}
				var h = d.getHours();
				var m = z(d.getMinutes());
				if (config.timeFormat == 12) {
					return " " + (h % 12 || 12) + ":" + m + (h < 12 ? " AM" : " PM");
				} else {
					return " " + h + ":" + m;
				}
			}
			innerHTML += formatTime(dueDateTime);
		}
		return this.createCell(className, innerHTML);
	},
	addProjectCell: function(item) {
		var project = this.tasks.projects.find(p => p.id === item.project_id);
		var innerHTML = "<div class='col projectname'>" + project.name + "</div>";
		return this.createCell("xsmall project", innerHTML);
	},
	addAssigneeAvatarCell: function(item, collaboratorsMap) {	
		var colIndex = collaboratorsMap.get(item.responsible_uid);

		var cell = this.createCell("image", "");

		// Add avatar image only if collaborator is defined
		if (typeof colIndex !== "undefined" && this.tasks.collaborators[colIndex].image_id!=null) {
			var avatarImg = document.createElement("img");
			avatarImg.className = "avatarImg";
			avatarImg.src = "https://dcff1xvirvpfp.cloudfront.net/" + this.tasks.collaborators[colIndex].image_id + "_big.jpg";
			cell.appendChild(avatarImg);
		} 

		return cell;
	},
	addAssigneeInitialsCell: function(item, collaboratorsMap) {
		var colIndex = collaboratorsMap.get(item.responsible_uid);
		var cell = this.createCell("assignee", "");

		if (typeof colIndex !== "undefined") {
			var collaborator = this.tasks.collaborators[colIndex];
			if (collaborator) {
				// 				var initials = collaborator.full_name
				// 	.split(" ")
				// 	.map(name => name.charAt(0).toUpperCase())
				// 	.join("");

				// var initialsCircle = document.createElement("div");
				// initialsCircle.className = "assignee-circle";
				// initialsCircle.innerText = initials;
				// cell.appendChild(initialsCircle);

				var profilePhoto = document.createElement("img");
				profilePhoto.className = "assignee-photo";
				profilePhoto.src = collaborator.image_id
					? `https://dcff1xvirvpfp.cloudfront.net/${collaborator.image_id}_big.jpg`
					: "https://via.placeholder.com/30"; // Fallback to placeholder if no image_id
				cell.appendChild(profilePhoto);
			}
		}

		return cell;
	},
	addProjectHeader: function(item) {	
		var project = this.tasks.projects.find(p => p.id === item.project_id);
		var innerHTML = "<div class='col projectname'>" + project.name + "</div>";
		var headerStyle = "";
		return this.createHeader("", innerHTML, headerStyle);
	},
	addCheckboxCell: function(item) {
		var cell = this.createCell("checkbox", "");
		var checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.className = "task-checkbox";
		checkbox.addEventListener("click", () => {
			this.markTaskDone(item.id);
		});
		cell.appendChild(checkbox);
		return cell;
	},
	markTaskDone: function(taskId) {
		const uuid = crypto.randomUUID(); // Generate a unique UUID for the request
		this.sendSocketNotification("CLOSE_TASK", { uuid: uuid, taskId: taskId });

		// Remove the task from the UI
		this.tasks.items = this.tasks.items.filter(item => item.id !== taskId);
		this.updateDom();
	},
	getDom: function () {
	
		if (this.config.hideWhenEmpty && this.tasks.items.length===0) {
			return null;
		}
	
		//Add a new div to be able to display the update time alone after all the task
		var wrapper = document.createElement("div");

		//display "loading..." if not loaded
		if (!this.loaded) {
			wrapper.innerHTML = "Loading...";
			wrapper.className = "dimmed light small";
			return wrapper;
		}

		// The tasks list uses a CSS flexgrid layout. All rows have a class of 'row' and all columns have a class of 'col'
		// Column or row specific styling may have additional classes.
		var divBody = document.createElement("div");
		divBody.className = "grid normal small light";

		if (this.tasks === undefined) {
			return wrapper;
		}

		// create mapping from user id to collaborator index
		var collaboratorsMap = new Map();

		for (var value=0; value < this.tasks.collaborators.length; value++) {
			collaboratorsMap.set(this.tasks.collaborators[value].id, value);
		}

		var lastProject = ""; // stores the last project name shown, used for grouping by project name

		//Iterate through Todos
		this.tasks.items.forEach(item => {
			var divRow = document.createElement("div");
			divRow.className = "row task";

			// Headers
			if (this.config.groupByProject && lastProject !== item.project_id) {
				divBody.append(this.addProjectHeader(item));
				lastProject = item.project_id;
			}

			// Columns
			divRow.appendChild(this.addCheckboxCell(item));
			divRow.appendChild(this.addPriorityIndicatorCell(item));
			divRow.appendChild(this.addTodoTextCell(item));
			divRow.appendChild(this.addDueDateCell(item));

			if (this.config.showProject && !this.config.groupByProject) {
				divRow.appendChild(this.addProjectCell(item));
			}

			if (this.config.displayAvatar) {
				divRow.appendChild(this.addAssigneeAvatarCell(item, collaboratorsMap));
			}

			divRow.appendChild(this.addAssigneeInitialsCell(item, collaboratorsMap));

			divBody.appendChild(divRow);
		});
		
		wrapper.appendChild(divBody);

		// create the gradient
		if (this.config.fade && this.config.fadePoint < 1) divBody.querySelectorAll('.row').forEach((row, i, rows) => row.style.opacity = Math.max(0, Math.min(1 - ((((i + 1) * (1 / (rows.length))) - this.config.fadePoint) / (1 - this.config.fadePoint)) * (1 - this.config.fadeMinimumOpacity), 1)));

		// display the update time at the end, if defined so by the user config
		if (this.config.displayLastUpdate) {
			var updateinfo = document.createElement("div");
			updateinfo.className = "xsmall light align-left";
			updateinfo.innerHTML = "Last Update : " + moment.unix(this.lastUpdate).format(this.config.displayLastUpdateFormat);
			wrapper.appendChild(updateinfo);
		}

		//**** FOR DEBUGGING TO HELP PEOPLE GET THEIR PROJECT IDs - (People who can't see console) */
		if (this.config.debug) {
			var projectsids = document.createElement("div");
			projectsids.className = "xsmall light align-left";
			projectsids.innerHTML = "<span>*** PROJECT -- ID ***</span><br />";
			this.tasks.projects.forEach(project => {
				projectsids.innerHTML += "<span>" + project.name + " -- " + project.id + "</span><br />";
			});
			wrapper.appendChild(projectsids);
		};
		//****** */

		return wrapper;
	}

});
