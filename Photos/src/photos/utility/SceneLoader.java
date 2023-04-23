package photos.utility;

import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

import javafx.fxml.FXMLLoader;
import javafx.geometry.Rectangle2D;
import javafx.scene.Parent;
import javafx.scene.Scene;
import javafx.stage.Screen;
import javafx.stage.Stage;

/**

SceneLoader is a utility class that provides methods to load FXML files and set up the corresponding scenes on the stage passed as a parameter.
@version 1.0
@since 2023-04-13
@author
Zihao Zheng,
Yiming Huang
*/
public class SceneLoader{
	/**
	 * Loads an FXML file and sets up the corresponding scene on the mainStage parameter passed. The FXML file path, controller class, pane type, and main stage must be provided as parameters.
	 * 
	 * @param fxmlPath a string representing the path of the FXML file to load.
	 * @param controllerClass the class object representing the controller of the FXML file.
	 * @param paneType the class object representing the type of the root pane in the FXML file.
	 * @param mainStage the stage on which to set up the loaded scene.
	 * @throws IOException if the FXML file could not be loaded.
	 */
	public static <T,F extends Parent> void loadFXML(String fxmlPath, Class<T> controllerClass, Class<F> paneType, Stage mainStage) throws IOException {
		FXMLLoader loader = new FXMLLoader();
	    loader.setLocation(SceneLoader.class.getResource(fxmlPath));
	    
	    F root = paneType.cast(loader.load());
	    T controller = loader.getController();
	    if (controller != null) {
	        Method setMainStageMethod;
	        try {
	            setMainStageMethod = controllerClass.getMethod("setMainStage", Stage.class);
	            setMainStageMethod.invoke(controller, mainStage);
	        } catch (NoSuchMethodException | SecurityException | IllegalAccessException | IllegalArgumentException | InvocationTargetException e) {
	            e.printStackTrace();
	        }
	    }
	    Scene scene = new Scene(root);
	    mainStage.setScene(scene);
	    mainStage.setResizable(false);
	    mainStage.show();
	    
	    
	    
	    
//		// Load the FXML file
//		FXMLLoader loader = new FXMLLoader();
//		loader.setLocation(getClass().getResource("/photos/view/nonAdmin.fxml"));
//		// Get the ancestor pane from the FXML file
//		Pane root = (Pane)loader.load();
//		// Get the controller listed in the ancesor pane and give a copy of "The Stage"
//		nonAdminController controller = loader.getController();
//		controller.setMainStage(mainStage);
//		// Create a new scene using the ancestor pane
//		Scene scene = new Scene(root);
//		// Change the scene in the stage
//		mainStage.setScene(scene);
//		// Set resizable of the window to false
//		mainStage.setResizable(false);
//		// Show the new scene
//		mainStage.show();
	    
	    
//		// Load the FXML file
//		FXMLLoader loader = new FXMLLoader();
//		loader.setLocation(getClass().getResource("/photos/view/Admin.fxml"));
//		// Get the ancestor pane from the FXML file
//		Pane root = (Pane)loader.load();
//		// Get the controller listed in the ancesor pane and give a copy of "The Stage"
//		AdminController controller = loader.getController();
//		controller.setMainStage(mainStage);
//		// Create a new scene using the ancestor pane
//		Scene scene = new Scene(root);
//		// Change the scene in the stage
//		mainStage.setScene(scene);
//		// Set resizable of the window to false
//		mainStage.setResizable(false);
//		// Show the new scene
//		mainStage.show();
	}
	
	
	/**
	 * Loads an FXML file and sets up the corresponding scene on the mainStage parameter passed, centering the stage on the screen. The FXML file path, controller class, pane type, and main stage must be provided as parameters.
	 * 
	 * @param fxmlPath a string representing the path of the FXML file to load.
	 * @param controllerClass the class object representing the controller of the FXML file.
	 * @param paneType the class object representing the type of the root pane in the FXML file.
	 * @param mainStage the stage on which to set up the loaded scene.
	 * @throws IOException if the FXML file could not be loaded.
	 */
	public static <T,F extends Parent> void loadFXMLCenter(String fxmlPath, Class<T> controllerClass, Class<F> paneType, Stage mainStage) throws IOException {
		FXMLLoader loader = new FXMLLoader();
	    loader.setLocation(SceneLoader.class.getResource(fxmlPath));
	    
	    F root = paneType.cast(loader.load());
	    T controller = loader.getController();
	    if (controller != null) {
	        Method setMainStageMethod;
	        try {
	            setMainStageMethod = controllerClass.getMethod("setMainStage", Stage.class);
	            setMainStageMethod.invoke(controller, mainStage);
	        } catch (NoSuchMethodException | SecurityException | IllegalAccessException | IllegalArgumentException | InvocationTargetException e) {
	            e.printStackTrace();
	        }
	    }
	    Scene scene = new Scene(root);
	    mainStage.setScene(scene);
	    mainStage.setResizable(false);
	    mainStage.show();
	    
	    // Center the stage on the screen
	    Rectangle2D screenBounds = Screen.getPrimary().getVisualBounds();
	    mainStage.setX((screenBounds.getWidth() - mainStage.getWidth()) / 2);
	    mainStage.setY((screenBounds.getHeight() - mainStage.getHeight()) / 2);

	}
}